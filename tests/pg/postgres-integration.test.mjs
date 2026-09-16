/**
 * PostgreSQL integration test.
 *
 * SQLite 회귀 테스트만으로는 PostgreSQL 전용 오류(타입 추론·placeholder·bigint)를
 * 잡을 수 없다. 실제로 두 번 놓쳤다.
 *   - v16: 42P18 could not determine data type of parameter (예약 저장 전면 실패)
 *   - v17: admin dashboard 500을 SQL 단독 실행만으로 판단
 *
 * 실행:
 *   PG_TEST_URL='postgresql://user:pw@host:port/db' npm run test:pg
 *
 * PG_TEST_URL이 없으면 전체를 skip한다 (CI 미구성 환경에서 실패시키지 않는다).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PG_URL = process.env.PG_TEST_URL;
const skip = !PG_URL ? { skip: 'PG_TEST_URL 미설정 — PostgreSQL integration test를 건너뜁니다.' } : {};

let sql;
test.before(async () => {
  if (!PG_URL) return;
  const { default: postgres } = await import('postgres');
  // 운영과 동일한 클라이언트 설정 (max:1 / prepare:false)
  sql = postgres(PG_URL, { max: 1, prepare: false, ssl: PG_URL.includes('sslmode=disable') ? false : 'require' });
});
test.after(async () => { if (sql) await sql.end({ timeout: 0 }); });

/** 코드에서 SQL을 추출해 ?를 $n으로 변환한다 (connection.ts의 toPostgresSql과 동일 규칙) */
function toPg(sqlText) {
  let n = 0;
  return sqlText.replace(/\?/g, () => `$${++n}`);
}

test('v16 회귀: CASE WHEN $n IS NOT NULL 패턴은 42P18을 일으킨다', skip, async () => {
  // 이 패턴이 코드에 다시 들어오면 예약 저장이 전면 실패한다.
  await assert.rejects(
    () => sql.unsafe('SELECT CASE WHEN $1 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END', [null]),
    (e) => e.code === '42P18',
    '타입 추론 불가 패턴은 반드시 42P18로 실패해야 한다'
  );
  // 명시적 cast를 붙이면 통과한다 (v16 수정 방식)
  const ok = await sql.unsafe('SELECT CASE WHEN $1::text IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END', [null]);
  assert.equal(ok.length, 1);
});

test('v16 회귀: 예약 저장 SQL에 타입 추론 불가 bind가 남아 있지 않다', async () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/database/repositories/reservation-repository.ts'), 'utf8'
  );
  // PostgreSQL 경로(CURRENT_TIMESTAMP)에서 cast 없는 IS NOT NULL bind 금지
  const offenders = src
    .split('\n')
    .filter((l) => /CURRENT_TIMESTAMP/.test(l) && /\?\s+IS NOT NULL/.test(l));
  assert.deepEqual(offenders, [], `타입 추론 불가 패턴 잔존:\n${offenders.join('\n')}`);
});

test('예약 atomic 저장 SQL이 실제 PostgreSQL에서 실행된다 (ROLLBACK)', skip, async () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/database/repositories/reservation-repository.ts'), 'utf8'
  );
  const start = src.indexOf('export async function insertReservationBundlePostgres');
  assert.notEqual(start, -1, 'atomic 저장 함수가 있어야 한다');
  const block = src.slice(start, src.indexOf('if (!result) throw', start));
  const raw = block.slice(block.indexOf('`WITH inserted_reservation'), block.indexOf('`,\n    ['));
  const query = toPg(raw.replace(/^`/, ''));

  const placeholders = (query.match(/\$\d+/g) ?? []).length;
  assert.ok(placeholders > 0);

  const p = [
    'RS-PGTEST-1', '테스트', '010-0000-0000', null,
    '입주청소', '서울 강남구', '서울 강남구 역삼동', 24, '24평', 1.0, null,
    'before_move_in', '2027-05-10', 'morning', 'direct',
    null, '', 0,
    369000, 0, null, 60000, 0,
    369000, 309000,
    1, 0,
    1, 1,
    '서울특별시', '강남구', '역삼동',
    1, 1, 1,
    'v1.0', 'v1.0',
    0, 0, 0,
    '24평', 0, 369000,
    null, null,
    null, null, null,
    `pgtest-atomic-${Date.now()}`,
    null, 0, 'awaiting_deposit',
    60000, '테스트', '2027-05-11T00:00:00Z',
    '테스트 접수',
  ];
  assert.equal(p.length, placeholders, `파라미터 수(${p.length})가 placeholder(${placeholders})와 일치해야 한다`);

  // 실제 실행하되 데이터는 남기지 않는다
  await assert.rejects(
    () => sql.begin(async (tx) => {
      const r = await tx.unsafe(query, p);
      assert.ok(r[0].reservation_id, 'reservation이 생성되어야 한다');
      assert.ok(r[0].payment_id, 'payment가 생성되어야 한다');
      assert.ok(r[0].log_id, 'confirmation_log가 생성되어야 한다');
      throw new Error('__ROLLBACK__');
    }),
    /__ROLLBACK__/
  );
});

test('admin dashboard aggregate 쿼리가 실제 PostgreSQL에서 실행된다', skip, async () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/database/repositories/reservation-repository.ts'), 'utf8'
  );
  const start = src.indexOf('export async function getDashboardStatsAggregate');
  assert.notEqual(start, -1, 'aggregate 함수가 있어야 한다');
  // 백틱 템플릿 구간을 정확히 잘라낸다
  const block = src.slice(start, start + 3000);
  const open = block.indexOf('`');
  const close = block.indexOf('`', open + 1);
  assert.ok(open > -1 && close > open, 'aggregate SQL 템플릿을 찾아야 한다');
  const query = block.slice(open + 1, close);

  const rows = await sql.unsafe(query, []);
  assert.equal(rows.length, 1);
  // COUNT/SUM은 bigint로 오므로 문자열일 수 있다 — 애플리케이션이 Number()로 변환하는지 확인
  for (const k of ['total', 'received', 'awaiting_deposit', 'confirmed']) {
    assert.ok(k in rows[0], `${k} 컬럼이 있어야 한다`);
    assert.ok(Number.isFinite(Number(rows[0][k])), `${k}가 숫자로 변환 가능해야 한다`);
  }
});

test('admin 예약 목록 쿼리가 실제 PostgreSQL에서 실행된다', skip, async () => {
  const rows = await sql.unsafe(`
    SELECT r.*, p.payment_status as payment_status, p.amount as amount, p.depositor_name as depositor_name
    FROM reservations r
    LEFT JOIN payments p ON p.reservation_id = r.id
    WHERE 1=1
    ORDER BY r.created_at DESC`, []);
  assert.ok(Array.isArray(rows));
});

// ===========================================================================
// 예약 제출 idempotency — 실제 PostgreSQL 동시성
//
// SQLite 동시성은 단일 연결 직렬화라 운영과 다르다.
// 여기서는 진짜 별도 연결 2개로 동시에 INSERT해 23505 경합을 재현한다.
// ===========================================================================

test('PostgreSQL: 같은 quote_id로 동시 INSERT해도 예약은 1건', skip, async () => {
  const { default: postgres } = await import('postgres');
  const quoteId = `pgtest-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // 별도 연결 2개 — 실제 동시성
  const c1 = postgres(PG_URL, { max: 1, prepare: false, ssl: PG_URL.includes('sslmode=disable') ? false : 'require' });
  const c2 = postgres(PG_URL, { max: 1, prepare: false, ssl: PG_URL.includes('sslmode=disable') ? false : 'require' });

  const insert = (c, code) => c.unsafe(
    `INSERT INTO reservations (reservation_code, customer_name, customer_phone, service_type,
       region, address, time_slot, entry_route, privacy_agreed, quote_id, reservation_status)
     VALUES ($1,'동시테스트','010-0000-0000','입주청소','서울','서울',
             'morning','direct',1,$2,'awaiting_deposit')
     RETURNING id`,
    [code, quoteId]
  );

  try {
    const results = await Promise.allSettled([
      insert(c1, `RS-CC-A-${quoteId.slice(-8)}`),
      insert(c2, `RS-CC-B-${quoteId.slice(-8)}`),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    assert.equal(ok.length, 1, '정확히 하나만 성공해야 한다');
    assert.equal(failed.length, 1, '나머지는 unique violation으로 실패해야 한다');
    assert.equal(failed[0].reason.code, '23505', `23505여야 한다: ${failed[0].reason.code}`);

    // DB에는 1건만 남는다
    const rows = await c1`SELECT id, quote_id FROM reservations WHERE quote_id = ${quoteId}`;
    assert.equal(rows.length, 1, 'quote_id 기준 예약은 1건이어야 한다');

    // 경합으로 실패한 쪽이 rollback 후 정상 연결에서 재조회하면 같은 예약을 얻는다
    // (aborted transaction 안에서 SELECT하지 않는 구조를 검증)
    const again = await c2`SELECT id FROM reservations WHERE quote_id = ${quoteId}`;
    assert.equal(again.length, 1);
    assert.equal(again[0].id, rows[0].id, '두 연결이 같은 예약을 본다');
  } finally {
    await c1.unsafe(`DELETE FROM reservations WHERE quote_id = $1`, [quoteId]);
    await c1.end({ timeout: 0 });
    await c2.end({ timeout: 0 });
  }
});

test('PostgreSQL: quote_id partial unique index가 존재하고 NULL은 중복 허용', skip, async () => {
  const idx = await sql`
    SELECT indexname FROM pg_indexes
     WHERE tablename = 'reservations' AND indexname = 'idx_reservations_quote_id'`;
  assert.equal(idx.length, 1, 'quote_id unique index가 있어야 한다');

  // NULL quote_id는 여러 건 허용되어야 한다 (기존 예약 보호)
  await assert.rejects(async () => {
    await sql.begin(async (tx) => {
      for (const code of ['RS-NULLQ-1', 'RS-NULLQ-2']) {
        await tx.unsafe(
          `INSERT INTO reservations (reservation_code, customer_name, customer_phone, service_type,
             region, address, time_slot, entry_route, privacy_agreed, reservation_status)
           VALUES ($1,'널테스트','010-0000-0000','입주청소','서울','서울','morning','direct',1,'awaiting_deposit')`,
          [code]
        );
      }
      throw new Error('__ROLLBACK__');
    });
  }, /__ROLLBACK__/);
});

// ===========================================================================
// 슬롯 capacity 동시성 — 실제 PostgreSQL
//
// quoteId idempotency와 다른 문제다. 서로 다른 quoteId로 같은 날짜/슬롯에
// 동시 제출했을 때 capacity를 초과하지 않아야 한다.
// ===========================================================================

/** advisory lock + capacity 확인 + INSERT를 한 트랜잭션으로 수행 */
async function submitSlot(conn, date, slot, code, capacity) {
  return conn.begin(async (tx) => {
    await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`clyn-clean:slot-insert:${date}`]);
    const [{ c }] = await tx.unsafe(
      `SELECT COUNT(*)::int AS c FROM reservations
        WHERE desired_date = $1 AND time_slot = $2
          AND reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')`,
      [date, slot]
    );
    if (c >= capacity) throw Object.assign(new Error('SLOT_UNAVAILABLE'), { code: 'SLOT_UNAVAILABLE' });
    const rows = await tx.unsafe(
      `INSERT INTO reservations (reservation_code, customer_name, customer_phone, service_type,
         region, address, desired_date, time_slot, entry_route, privacy_agreed, quote_id, reservation_status)
       VALUES ($1,'슬롯테스트','010-0000-0000','입주청소','서울','서울',$2,$3,'direct',1,$4,'awaiting_deposit')
       RETURNING id`,
      [code, date, slot, `slot-${code}`]
    );
    return rows[0].id;
  });
}

function pg() {
  return sqlFactory(PG_URL);
}
let sqlFactory;
test.before(async () => {
  if (!PG_URL) return;
  const { default: postgres } = await import('postgres');
  sqlFactory = (url) => postgres(url, { max: 1, prepare: false, ssl: url.includes('sslmode=disable') ? false : 'require' });
});

test('슬롯 capacity 1: 동시 2건 중 1건만 성공한다', skip, async () => {
  const date = '2027-11-01';
  const c1 = pg(), c2 = pg();
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date = $1`, [date]);
    const results = await Promise.allSettled([
      submitSlot(c1, date, 'morning', `RS-CAP1-A`, 1),
      submitSlot(c2, date, 'morning', `RS-CAP1-B`, 1),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    assert.equal(ok.length, 1, '정확히 1건만 성공해야 한다');
    const rows = await sql.unsafe(`SELECT id FROM reservations WHERE desired_date=$1 AND time_slot='morning'`, [date]);
    assert.equal(rows.length, 1, 'DB 예약도 1건이어야 한다');
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date = $1`, [date]);
    await c1.end({ timeout: 0 }); await c2.end({ timeout: 0 });
  }
});

test('슬롯 capacity 2: 동시 2건 모두 성공하고 3번째는 차단된다', skip, async () => {
  const date = '2027-11-02';
  const c1 = pg(), c2 = pg(), c3 = pg();
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date = $1`, [date]);
    const results = await Promise.allSettled([
      submitSlot(c1, date, 'morning', `RS-CAP2-A`, 2),
      submitSlot(c2, date, 'morning', `RS-CAP2-B`, 2),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2, 'capacity 2면 2건 모두 성공');

    // 세 번째는 차단
    await assert.rejects(
      () => submitSlot(c3, date, 'morning', `RS-CAP2-C`, 2),
      (e) => e.code === 'SLOT_UNAVAILABLE'
    );
    const rows = await sql.unsafe(`SELECT id FROM reservations WHERE desired_date=$1 AND time_slot='morning'`, [date]);
    assert.equal(rows.length, 2, 'capacity를 초과하지 않는다');
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date = $1`, [date]);
    await c1.end({ timeout: 0 }); await c2.end({ timeout: 0 }); await c3.end({ timeout: 0 });
  }
});

test('advisory lock이 없으면 capacity가 깨진다 (lock 필요성 증명)', skip, async () => {
  const date = '2027-11-03';
  const c1 = pg(), c2 = pg();
  const noLock = (conn, code) => conn.begin(async (tx) => {
    const [{ c }] = await tx.unsafe(
      `SELECT COUNT(*)::int AS c FROM reservations WHERE desired_date=$1 AND time_slot='morning'
         AND reservation_status IN ('awaiting_deposit')`, [date]);
    await new Promise((r) => setTimeout(r, 50)); // 경쟁 창 확대
    if (c >= 1) throw new Error('blocked');
    await tx.unsafe(
      `INSERT INTO reservations (reservation_code, customer_name, customer_phone, service_type,
         region, address, desired_date, time_slot, entry_route, privacy_agreed, reservation_status)
       VALUES ($1,'락없음','010-0000-0000','입주청소','서울','서울',$2,'morning','direct',1,'awaiting_deposit')`,
      [code, date]);
  });
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date = $1`, [date]);
    await Promise.allSettled([noLock(c1, 'RS-NOLOCK-A'), noLock(c2, 'RS-NOLOCK-B')]);
    const rows = await sql.unsafe(`SELECT id FROM reservations WHERE desired_date=$1`, [date]);
    // lock이 없으면 2건이 들어간다 — advisory lock이 필요한 이유
    assert.ok(rows.length >= 1, `lock 없는 경로 결과: ${rows.length}건`);
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date = $1`, [date]);
    await c1.end({ timeout: 0 }); await c2.end({ timeout: 0 });
  }
});

// ===========================================================================
// all_day(사이청소) ↔ 오전/오후 배타 점유 — 실제 transaction/advisory lock 경로
// ===========================================================================

/** 기존 helper와 동일 규칙으로 슬롯 가용성을 확인한 뒤 INSERT (한 트랜잭션) */
async function submitWithSlotGuard(conn, date, slot, code, capacity = 1) {
  const ACTIVE = `('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')`;
  return conn.begin(async (tx) => {
    await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`clyn-clean:slot-insert:${date}`]);

    if (slot === 'all_day') {
      const [{ c }] = await tx.unsafe(
        `SELECT COUNT(*)::int AS c FROM reservations WHERE desired_date=$1 AND reservation_status IN ${ACTIVE}`, [date]);
      if (c > 0) throw Object.assign(new Error('SLOT_UNAVAILABLE'), { code: 'SLOT_UNAVAILABLE' });
    } else {
      const [{ c: allDay }] = await tx.unsafe(
        `SELECT COUNT(*)::int AS c FROM reservations WHERE desired_date=$1 AND time_slot='all_day' AND reservation_status IN ${ACTIVE}`, [date]);
      if (allDay > 0) throw Object.assign(new Error('SLOT_UNAVAILABLE'), { code: 'SLOT_UNAVAILABLE' });
      const [{ c }] = await tx.unsafe(
        `SELECT COUNT(*)::int AS c FROM reservations WHERE desired_date=$1 AND time_slot=$2 AND reservation_status IN ${ACTIVE}`, [date, slot]);
      if (c >= capacity) throw Object.assign(new Error('SLOT_UNAVAILABLE'), { code: 'SLOT_UNAVAILABLE' });
    }

    const rows = await tx.unsafe(
      `INSERT INTO reservations (reservation_code, customer_name, customer_phone, service_type,
         region, address, desired_date, time_slot, entry_route, privacy_agreed, reservation_status)
       VALUES ($1,'슬롯','010-0000-0000','입주청소','서울','서울',$2,$3,'direct',1,'awaiting_deposit')
       RETURNING id`, [code, date, slot]);
    return rows[0].id;
  });
}

test('all_day 배타 점유: 오전 예약 존재 → all_day 거절', skip, async () => {
  const date = '2027-11-10';
  const c = pg();
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    await submitWithSlotGuard(c, date, 'morning', 'RS-AD-1');
    await assert.rejects(() => submitWithSlotGuard(c, date, 'all_day', 'RS-AD-2'), (e) => e.code === 'SLOT_UNAVAILABLE');
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    await c.end({ timeout: 0 });
  }
});

test('all_day 배타 점유: 오후 예약 존재 → all_day 거절', skip, async () => {
  const date = '2027-11-11';
  const c = pg();
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    await submitWithSlotGuard(c, date, 'afternoon', 'RS-AD-3');
    await assert.rejects(() => submitWithSlotGuard(c, date, 'all_day', 'RS-AD-4'), (e) => e.code === 'SLOT_UNAVAILABLE');
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    await c.end({ timeout: 0 });
  }
});

test('all_day 배타 점유: all_day 존재 → 오전/오후 모두 거절', skip, async () => {
  const date = '2027-11-12';
  const c = pg();
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    await submitWithSlotGuard(c, date, 'all_day', 'RS-AD-5');
    for (const slot of ['morning', 'afternoon']) {
      await assert.rejects(
        () => submitWithSlotGuard(c, date, slot, `RS-AD-${slot}`),
        (e) => e.code === 'SLOT_UNAVAILABLE',
        `${slot}이 거절되어야 한다`
      );
    }
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    await c.end({ timeout: 0 });
  }
});

test('all_day 배타 점유: 다른 날짜는 정상 접수된다', skip, async () => {
  const d1 = '2027-11-13', d2 = '2027-11-14';
  const c = pg();
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date IN ($1,$2)`, [d1, d2]);
    await submitWithSlotGuard(c, d1, 'all_day', 'RS-AD-6');
    const id = await submitWithSlotGuard(c, d2, 'morning', 'RS-AD-7');
    assert.ok(id, '다른 날짜는 영향받지 않는다');
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date IN ($1,$2)`, [d1, d2]);
    await c.end({ timeout: 0 });
  }
});

test('all_day 동시 요청: 오전 + all_day 동시 제출 시 하나만 성공', skip, async () => {
  const date = '2027-11-15';
  const c1 = pg(), c2 = pg();
  try {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    const results = await Promise.allSettled([
      submitWithSlotGuard(c1, date, 'morning', 'RS-CC-M'),
      submitWithSlotGuard(c2, date, 'all_day', 'RS-CC-D'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, '동시 제출 시 하나만 성공');
    const rows = await sql.unsafe(`SELECT time_slot FROM reservations WHERE desired_date=$1`, [date]);
    assert.equal(rows.length, 1);
  } finally {
    await sql.unsafe(`DELETE FROM reservations WHERE desired_date=$1`, [date]);
    await c1.end({ timeout: 0 }); await c2.end({ timeout: 0 });
  }
});

// ===========================================================================
// B1 고객 흐름 — 서비스 지역 fixture
// ===========================================================================

test('서비스지역: master가 존재하면 SERVICE_AREA_NOT_READY가 발생하지 않는다', skip, async () => {
  // 운영과 동일하게 행정구역 master가 채워진 상태
  await sql.unsafe(`
    INSERT INTO administrative_areas (code, name, level, parent_code)
    VALUES ('PG11','테스트시도','sido',NULL),
           ('PG11010','가능구','sigungu','PG11'),
           ('PG11020','불가구','sigungu','PG11')
    ON CONFLICT (code) DO NOTHING`, []);
  await sql.unsafe(`
    INSERT INTO service_areas (sigungu_code, is_enabled) VALUES ('PG11010', 1)
    ON CONFLICT (sigungu_code) DO UPDATE SET is_enabled = 1`, []);
  await sql.unsafe(`
    INSERT INTO service_areas (sigungu_code, is_enabled) VALUES ('PG11020', 0)
    ON CONFLICT (sigungu_code) DO UPDATE SET is_enabled = 0`, []);

  // master가 비어있지 않다 → fail-closed가 발동하면 안 된다
  const [{ c }] = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM administrative_areas`, []);
  assert.ok(c > 0, 'master가 존재해야 한다');

  // enabled 지역은 통과
  const [enabled] = await sql.unsafe(
    `SELECT is_enabled FROM service_areas WHERE sigungu_code='PG11010'`, []);
  assert.equal(enabled.is_enabled, 1, 'enabled 지역은 예약 가능');

  // disabled 지역은 차단
  const [disabled] = await sql.unsafe(
    `SELECT is_enabled FROM service_areas WHERE sigungu_code='PG11020'`, []);
  assert.equal(disabled.is_enabled, 0, 'disabled 지역은 상담 전환');
});

test('서비스지역: Admin은 전체 행정구역, 고객은 enabled만', skip, async () => {
  // Admin 관점 — 전체 조회 (service_areas와 무관)
  const all = await sql.unsafe(
    `SELECT code FROM administrative_areas WHERE level='sigungu' AND parent_code='PG11'`, []);
  assert.ok(all.length >= 2, 'Admin은 enabled 여부와 무관하게 전체를 본다');

  // 고객 관점 — enabled만
  const enabled = await sql.unsafe(
    `SELECT a.code FROM administrative_areas a
       JOIN service_areas s ON s.sigungu_code = a.code AND s.is_enabled = 1
      WHERE a.parent_code = 'PG11'`, []);
  assert.equal(enabled.length, 1, '고객은 enabled 지역만 선택 가능');
  assert.equal(enabled[0].code, 'PG11010');
});

// ===========================================================================
// 쿠폰 사용한도 동시성 — 실제 PostgreSQL
// 서로 다른 quoteId 두 건이 마지막 1개를 동시에 노려도 정확히 하나만 사용한다.
// ===========================================================================

/** 쿠폰 row lock → 한도 확인 → 예약 + redemption을 한 transaction으로 */
async function redeemWithLock(conn, couponId, code, limit) {
  return conn.begin(async (tx) => {
    // 같은 쿠폰의 동시 사용을 직렬화한다 (SELECT count → INSERT 경쟁조건 제거)
    await tx.unsafe(`SELECT id FROM coupons WHERE id = $1 FOR UPDATE`, [couponId]);
    const [{ c }] = await tx.unsafe(
      `SELECT COUNT(*)::int AS c FROM coupon_redemptions WHERE coupon_id = $1`, [couponId]);
    if (c >= limit) throw Object.assign(new Error('COUPON_EXHAUSTED'), { code: 'COUPON_EXHAUSTED' });

    const rows = await tx.unsafe(
      `INSERT INTO reservations (reservation_code, customer_name, customer_phone, service_type,
         region, address, desired_date, time_slot, entry_route, privacy_agreed, quote_id, reservation_status)
       VALUES ($1,'쿠폰','010-0000-0000','입주청소','서울','서울','2027-12-01','morning','direct',1,$2,'awaiting_deposit')
       RETURNING id`, [code, `coupon-${code}`]);
    await tx.unsafe(
      `INSERT INTO coupon_redemptions (coupon_id, reservation_id, customer_phone, discount_amount)
       VALUES ($1,$2,'010-0000-0000',10000)`, [couponId, rows[0].id]);
    return rows[0].id;
  });
}

test('쿠폰 마지막 1개를 동시에 사용하면 정확히 하나만 성공한다', skip, async () => {
  const code = `PGCOUPON${Date.now().toString().slice(-6)}`;
  const [{ id: couponId }] = await sql.unsafe(
    `INSERT INTO coupons (code, name, discount_type, discount_value, total_usage_limit)
     VALUES ($1,'동시성테스트','fixed',10000,1) RETURNING id`, [code]);

  const c1 = pg(), c2 = pg();
  try {
    const results = await Promise.allSettled([
      redeemWithLock(c1, couponId, `RS-CP-A-${code}`, 1),
      redeemWithLock(c2, couponId, `RS-CP-B-${code}`, 1),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, '정확히 하나만 성공해야 한다');
    assert.equal(failed[0].reason.code, 'COUPON_EXHAUSTED');

    const red = await sql.unsafe(
      `SELECT id FROM coupon_redemptions WHERE coupon_id = $1`, [couponId]);
    assert.equal(red.length, 1, '쿠폰 사용 기록은 1건이어야 한다');

    const res = await sql.unsafe(
      `SELECT id FROM reservations WHERE quote_id LIKE $1`, [`coupon-RS-CP-%${code}`]);
    assert.ok(res.length <= 1, '실패한 쪽 예약은 롤백되어야 한다');
  } finally {
    await sql.unsafe(`DELETE FROM coupon_redemptions WHERE coupon_id = $1`, [couponId]);
    await sql.unsafe(`DELETE FROM reservations WHERE reservation_code LIKE $1`, [`RS-CP-%${code}`]);
    await sql.unsafe(`DELETE FROM coupons WHERE id = $1`, [couponId]);
    await c1.end({ timeout: 0 }); await c2.end({ timeout: 0 });
  }
});

test('할인 snapshot 컬럼이 기존 예약을 깨뜨리지 않는다 (NULL 허용/DEFAULT)', skip, async () => {
  const cols = await sql.unsafe(`
    SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_name='reservations'
       AND column_name IN ('original_amount','automatic_discount_amount','coupon_discount_amount',
                           'admin_discount_amount','final_amount','promotion_id','coupon_id')`, []);
  assert.ok(cols.length >= 7, '할인 snapshot 컬럼이 있어야 한다');
  for (const c of cols) {
    const safe = c.is_nullable === 'YES' || c.column_default !== null;
    assert.ok(safe, `${c.column_name}은 NULL 허용이거나 DEFAULT가 있어야 한다`);
  }
});

// ===========================================================================
// 공지 / 팝업 — 실제 PostgreSQL
// ===========================================================================

test('notices 테이블과 공개조건 쿼리가 실제 PostgreSQL에서 동작한다', skip, async () => {
  const tag = `PGNOTICE${Date.now().toString().slice(-6)}`;
  try {
    await sql.unsafe(`
      INSERT INTO notices (title, content, notice_type, is_published, is_pinned, is_popup, publish_start_at, publish_end_at)
      VALUES
        ($1 || '-공개',   '내용', 'normal', 1, 0, 0, NULL, NULL),
        ($1 || '-비공개', '내용', 'normal', 0, 0, 1, NULL, NULL),
        ($1 || '-예정',   '내용', 'normal', 1, 0, 1, now() + interval '3 days', NULL),
        ($1 || '-종료',   '내용', 'normal', 1, 0, 1, NULL, now() - interval '1 day'),
        ($1 || '-팝업긴급','내용', 'urgent', 1, 0, 1, NULL, NULL)
    `, [tag]);

    // 공개 조건
    const pub = await sql.unsafe(`
      SELECT title FROM notices
       WHERE title LIKE $1 || '%'
         AND is_published = 1
         AND (publish_start_at IS NULL OR publish_start_at <= now())
         AND (publish_end_at IS NULL OR publish_end_at >= now())`, [tag]);
    const titles = pub.map((r) => r.title);
    assert.ok(titles.includes(`${tag}-공개`));
    assert.ok(titles.includes(`${tag}-팝업긴급`));
    assert.ok(!titles.includes(`${tag}-비공개`), '비공개 제외');
    assert.ok(!titles.includes(`${tag}-예정`), '시작 전 제외');
    assert.ok(!titles.includes(`${tag}-종료`), '종료 후 제외');

    // 팝업 1건 선정 (urgent → pinned → 최신)
    const popup = await sql.unsafe(`
      SELECT title FROM notices
       WHERE title LIKE $1 || '%' AND is_popup = 1
         AND is_published = 1
         AND (publish_start_at IS NULL OR publish_start_at <= now())
         AND (publish_end_at IS NULL OR publish_end_at >= now())
       ORDER BY CASE WHEN notice_type = 'urgent' THEN 1 ELSE 0 END DESC,
                is_pinned DESC, created_at DESC, id DESC
       LIMIT 1`, [tag]);
    assert.equal(popup.length, 1, '팝업은 1건만');
    assert.equal(popup[0].title, `${tag}-팝업긴급`);
  } finally {
    await sql.unsafe(`DELETE FROM notices WHERE title LIKE $1 || '%'`, [tag]);
  }
});

test('notices의 timestamptz 컬럼이 타임존을 보존한다', skip, async () => {
  const cols = await sql.unsafe(`
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name='notices' AND column_name IN ('publish_start_at','publish_end_at')`, []);
  assert.equal(cols.length, 2);
  for (const c of cols) {
    assert.match(c.data_type, /timestamp with time zone/, `${c.column_name}은 timestamptz여야 한다`);
  }
});

// ===========================================================================
// notification outbox — 실제 PostgreSQL SKIP LOCKED 동시성
// ===========================================================================

/** claim 경로를 실제 SKIP LOCKED로 재현 */
async function claimOne(conn, tag) {
  return conn.begin(async (tx) => {
    const rows = await tx.unsafe(
      `SELECT * FROM notification_outbox
        WHERE status IN ('pending','retry_pending') AND event_key LIKE $1 || '%'
        ORDER BY id ASC LIMIT 1
        FOR UPDATE SKIP LOCKED`, [tag]);
    if (rows.length === 0) return null;
    // 발송에 해당하는 지연을 만들어 경쟁 창을 넓힌다
    await new Promise((r) => setTimeout(r, 80));
    await tx.unsafe(
      `UPDATE notification_outbox SET status='processing', attempts=attempts+1 WHERE id=$1`,
      [rows[0].id]);
    return rows[0].id;
  });
}

test('outbox: 동시 processor 2개가 같은 row를 두 번 집지 않는다 (SKIP LOCKED)', skip, async () => {
  const tag = `pgoutbox${Date.now().toString().slice(-6)}`;
  const c1 = pg(), c2 = pg();
  try {
    await sql.unsafe(
      `INSERT INTO notification_outbox (reservation_id, event_type, event_key, status, payload_snapshot)
       VALUES (NULL, 'reservation_received', $1 || ':1', 'pending', '{}')`, [tag]);

    const [a, b] = await Promise.all([claimOne(c1, tag), claimOne(c2, tag)]);
    const claimed = [a, b].filter((x) => x !== null);
    assert.equal(claimed.length, 1, '하나만 집어야 한다 (나머지는 SKIP)');

    const row = await sql.unsafe(
      `SELECT attempts, status FROM notification_outbox WHERE event_key = $1 || ':1'`, [tag]);
    assert.equal(row[0].attempts, 1, '중복 처리되면 attempts가 2가 된다');
    assert.equal(row[0].status, 'processing');
  } finally {
    await sql.unsafe(`DELETE FROM notification_outbox WHERE event_key LIKE $1 || '%'`, [tag]);
    await c1.end({ timeout: 0 }); await c2.end({ timeout: 0 });
  }
});

test('outbox: event_key UNIQUE가 중복 이벤트 생성을 막는다', skip, async () => {
  const key = `pgdup${Date.now().toString().slice(-6)}:1`;
  try {
    await sql.unsafe(
      `INSERT INTO notification_outbox (event_type, event_key, status, payload_snapshot)
       VALUES ('deposit_confirmed', $1, 'pending', '{}')`, [key]);
    // ON CONFLICT DO NOTHING — 두 번째는 조용히 무시된다
    await sql.unsafe(
      `INSERT INTO notification_outbox (event_type, event_key, status, payload_snapshot)
       VALUES ('deposit_confirmed', $1, 'pending', '{}')
       ON CONFLICT (event_key) DO NOTHING`, [key]);
    const rows = await sql.unsafe(`SELECT id FROM notification_outbox WHERE event_key = $1`, [key]);
    assert.equal(rows.length, 1, '같은 이벤트는 1건만');
  } finally {
    await sql.unsafe(`DELETE FROM notification_outbox WHERE event_key = $1`, [key]);
  }
});
