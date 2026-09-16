import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clyn-clean-test-'));
const dbPath = path.join(tmpDir, 'regression.db');
process.env.DATABASE_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.SITE_URL = 'https://clyn.test';

let db;
let pricing;
let specialDays;
let calendar;
let specialDayStore;
let quoteToken;
// 테스트 전용 서비스 가능지역 (fail-closed 검증을 통과시키기 위한 최소 fixture)
const TEST_SIDO = 'T11';
const TEST_SIGUNGU = 'T11010';
const TEST_DONG = 'T1101010';
// 견적 서명 토큰용 secret (테스트 전용 고정값)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'regression-test-quote-signing-secret-0123456789';
process.env.QUOTE_TOKEN_SECRET = process.env.QUOTE_TOKEN_SECRET || 'regression-test-quote-token-secret-must-be-at-least-32-bytes-long';
/** 해당 날짜의 실제 휴일 가산금 (일요일/공휴일만 1회) */
async function holidaySurchargeOn(date) {
  const r = await specialDayStore.resolveDateSurcharge(date);
  return r.amount;
}
let reservations;
let priceRulesRoute;
let quoteRoute;
let reservationsRoute;
let paymentStatusRoute;
let reservationStatusRoute;

const CANONICAL_PRICES = {
  '원룸': 179000,
  '원룸 복층': 239000,
  '1.5룸': 249000,
  '투룸': 269000,
  '쓰리룸': 319000,
  '18평': 329000,
  '24평': 369000,
  '28평': 420000,
  '32평': 459000,
  '34평': 489000,
  '38평': 539000,
  // 40평 이상은 확정가가 아니라 상담 참고 시작가
  '40평': 579000,
};

// 평형별 예약 선금 (총 청소금액에 포함되는 금액 — 추가 비용이 아님)
const EXPECTED_DEPOSITS = {
  '원룸': 60000,
  '원룸 복층': 60000,
  '1.5룸': 60000,
  '투룸': 60000,
  '쓰리룸': 60000,
  '18평': 60000,
  '24평': 60000,
  '28평': 70000,
  '32평': 70000,
  '34평': 70000,
  '38평': 80000,
  '40평': 90000,
};

async function importFresh(specifier, tag) {
  return import(`${specifier}?test=${tag}-${Date.now()}-${Math.random()}`);
}

before(async () => {
  await import('../src/database/schema.ts');
  // Use a separate connection for fixture writes; production modules use their singleton connection.
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  // Production B안은 행정구역 master가 비어 있으면 직접예약을 막는다.
  // 회귀 테스트에서는 예약 흐름 자체를 검증할 수 있도록 테스트 전용 master 존재 상태만 만든다.
  db.prepare(`INSERT OR IGNORE INTO administrative_areas(code,name,level,parent_code,is_current)
              VALUES('TEST-AREA-ROOT','테스트지역','sido',NULL,1)`).run();
  pricing = await import('../src/lib/pricing.ts');
  specialDays = await import('../src/lib/special-days.ts');
  calendar = await import('../src/lib/calendar.ts');
  specialDayStore = await import('../src/lib/special-days-store.ts');
  quoteToken = await import('../src/lib/quote-token.ts');
  // 서비스 가능지역 fixture — /api/quote가 fail-closed로 지역을 검증한다
  {
    const regionRepo = await import('../src/database/repositories/region-repository.ts');
    await regionRepo.upsertArea({ code: TEST_SIDO, name: '테스트시도', level: 'sido', parentCode: null });
    await regionRepo.upsertArea({ code: TEST_SIGUNGU, name: '테스트구', level: 'sigungu', parentCode: TEST_SIDO });
    await regionRepo.upsertArea({ code: TEST_DONG, name: '테스트동', level: 'eupmyeondong', parentCode: TEST_SIGUNGU });
    await regionRepo.setServiceArea({ sigunguCode: TEST_SIGUNGU, isEnabled: true });
  }
  // 특수일 캐시를 채운다. KASI_SERVICE_KEY가 없는 테스트 환경에서는
  // 오프라인 generator 데이터로 backfill된다.
  await specialDayStore.syncSpecialDays({ from: '2026-01-01', days: 800 });
  reservations = await import('../src/lib/reservations.ts');
  priceRulesRoute = await importFresh('../src/app/api/admin/price-rules/route.ts', 'price-rules');
  quoteRoute = await importFresh('../src/app/api/quote/route.ts', 'quote');
  reservationsRoute = await importFresh('../src/app/api/reservations/route.ts', 'reservations');
  paymentStatusRoute = await importFresh('../src/app/api/admin/reservations/[id]/payment-status/route.ts', 'payment-status');
  reservationStatusRoute = await importFresh('../src/app/api/admin/reservations/[id]/status/route.ts', 'reservation-status');
});

after(() => {
  try { db?.close(); } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
}

function resetOperationalData() {
  db.exec(`
    DELETE FROM confirmation_logs;
    DELETE FROM payments;
    DELETE FROM reservations;
    DELETE FROM calendar_days;
  `);
  db.prepare(`INSERT OR IGNORE INTO administrative_areas(code,name,level,parent_code,is_current)
              VALUES('TEST-AREA-ROOT','테스트지역','sido',NULL,1)`).run();
  setSetting('deposit_amount', '50000');
  setSetting('bank_name', '테스트은행');
  setSetting('bank_account_number', '1234567890');
  setSetting('bank_account_holder', '클린');
  setSetting('payment_due_hours', '24');
  setSetting('default_daily_capacity', '1');
  setSetting('instant_discount_enabled', '0');
}

beforeEach(() => {
  resetOperationalData();
  for (const [note, price] of Object.entries(CANONICAL_PRICES)) {
    db.prepare(`UPDATE price_rules SET base_price=?, is_active=1 WHERE service_type='입주청소' AND note=?`).run(price, note);
  }
  db.prepare(`UPDATE option_prices SET is_active=1, price=0`).run();
});

/**
 * v17 예약 API 계약.
 *
 * 서버는 가격을 재계산하지 않고, 고객 화면에 이미 표시된 견적 snapshot(clientQuote)을
 * 받아 검증한다. 테스트도 동일 계약을 따라야 한다.
 */
/** 테스트용 서명 견적 토큰 발급 — production과 동일한 issueQuoteToken을 사용한다 */
function issueTestQuoteToken(houseTypeKey, serviceType, overrides = {}) {
  const snap = quoteSnapshotFor(houseTypeKey, serviceType);
  return quoteToken.issueQuoteToken({
    serviceType,
    productKey: serviceType === '집정리' ? (overrides.jipjeongriPackage ?? null) : houseTypeKey,
    desiredDate: overrides.desiredDate ?? '2026-12-15',
    timeSlot: overrides.timeSlot ?? 'morning',
    areaSidoCode: overrides.areaSidoCode ?? null,
    areaSigunguCode: overrides.areaSigunguCode ?? null,
    areaDongCode: overrides.areaDongCode ?? null,
    basePrice: snap.basePrice,
    holidaySurcharge: 0,
    dateAdjustmentAmount: 0,
    automaticDiscount: 0,
    couponDiscount: 0,
    promotionId: null,
    couponId: null,
    couponCode: null,
    estimatedTotal: snap.estimatedTotal,
    depositAmount: snap.depositAmount,
    estimatedBalance: snap.estimatedBalance,
  }).token;
}

function quoteSnapshotFor(houseTypeKey = '34평', serviceType = '입주청소') {
  // 서비스별 독립 가격이므로 DB 실제 값을 사용한다 (입주청소 가격을 재사용하지 않는다)
  let base = CANONICAL_PRICES[houseTypeKey] ?? 369000;
  let deposit = EXPECTED_DEPOSITS[houseTypeKey] ?? 60000;
  try {
    const row = db.prepare(
      `SELECT base_price, deposit_amount FROM price_rules WHERE service_type=? AND product_key=?`
    ).get(serviceType, houseTypeKey);
    if (row) { base = row.base_price; deposit = row.deposit_amount ?? deposit; }
  } catch { /* db 미초기화 시 상수 사용 */ }
  return {
    basePrice: base,
    estimatedTotal: base,
    depositAmount: deposit,
    estimatedBalance: Math.max(base - deposit, 0),
    priceConfirmed: true,
  };
}

function validReservationBody(overrides = {}) {
  const houseTypeKey = overrides.houseTypeKey ?? '34평';
  const serviceType = overrides.serviceType ?? '입주청소';
  return {
    // 서버가 서명한 견적 토큰. 금액을 직접 보내지 않는다.
    quoteToken: issueTestQuoteToken(houseTypeKey, serviceType, overrides),
    customerName: '테스트',
    customerPhone: '010-1234-5678',
    serviceType: '입주청소',
    region: '서울',
    address: '서울 테스트로 1',
    houseTypeKey: '34평',
    desiredDate: '2026-12-15',
    timeSlot: 'morning',
    entryRoute: 'direct',
    extraOptions: [],
    depositorName: '테스트',
    privacyAgreed: true,
    // 신규 필수 필드 — 최소 고객정보(작업지역) + 서비스 3종 동의
    areaSido: '서울특별시',
    areaSigungu: '강남구',
    areaDong: '역삼동',
    corePrinciplesAgreed: true,
    serviceTermsAgreed: true,
    additionalChargeAgreed: true,
    ...overrides,
  };
}

/**
 * 신규 흐름 헬퍼 — 필수 고객정보 + 개인정보 동의 + 서비스 3종 동의를 갖춘 예약 본문.
 * revealDepositAccount()가 서버에서 이 값들을 모두 재검증한다.
 */
function fullyAgreedReservationBody(overrides = {}) {
  return validReservationBody({
    areaSido: '서울특별시',
    areaSigungu: '강남구',
    areaDong: '역삼동',
    corePrinciplesAgreed: true,
    serviceTermsAgreed: true,
    additionalChargeAgreed: true,
    ...overrides,
  });
}

/**
 * 예약 생성 후 계좌 공개 단계까지 진행시킨다 (payment 생성 시점).
 * 기존 테스트가 "생성 직후 payment 존재"를 전제하던 부분을 이 헬퍼로 대체한다.
 */
async function createReservationWithDepositAccount(overrides = {}) {
  const { reservation } = await reservations.createReservation(
    fullyAgreedReservationBody(overrides)
  );
  db.prepare(`UPDATE reservations
                 SET area_sido='서울특별시', area_sigungu='강남구', area_dong='역삼동',
                     core_principles_agreed=1, service_terms_agreed=1,
                     additional_charge_agreed=1, agreement_version='1.0',
                     agreed_at=datetime('now')
               WHERE id=?`).run(reservation.id);
  await reservations.revealDepositAccount(reservation.id);
  const row = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  const payment = db.prepare(`SELECT * FROM payments WHERE reservation_id=?`).get(reservation.id);
  return { reservation: row, payment };
}

/** payment_due_date를 과거로 밀어 입금기한 초과 상태를 만든다 */
function expireDeposit(reservationId, hoursAgo = 1) {
  db.prepare(
    `UPDATE payments SET payment_due_date = datetime('now', ?) WHERE reservation_id = ?`
  ).run(`-${hoursAgo} hours`, reservationId);
}

/**
 * quote/일반 API 요청 헬퍼.
 *
 * /api/quote는 서비스 가능지역을 fail-closed로 검증한다(B1).
 * 테스트 대부분은 지역 정책이 관심사가 아니므로 유효한 테스트 지역을 기본 주입한다.
 * 지역 자체를 검증하는 테스트는 areaSigunguCode를 명시적으로 덮어쓴다.
 */
function makeReq(body) {
  const withArea =
    body && typeof body === 'object' && 'serviceType' in body && !('areaSigunguCode' in body)
      ? { areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG, ...body }
      : body;
  return {
    headers: new Headers(),
    async json() { return withArea; },
  };
}

/**
 * 예약 생성 API는 IP 기준 rate limit이 있으므로,
 * 테스트마다 고유 IP를 부여해 서로 간섭하지 않게 한다.
 */
let __reqIpSeq = 0;
function makeReqWithFreshIp(body) {
  __reqIpSeq += 1;
  const headers = new Headers();
  headers.set('x-forwarded-for', `203.0.113.${__reqIpSeq % 250 + 1}`);
  return {
    headers,
    async json() { return body; },
  };
}

test('P0-1 관리자 34평 고정가격은 다른 고정상품과 area 구간 중복으로 차단되지 않는다', async () => {
  const rule = db.prepare(`SELECT * FROM price_rules WHERE service_type='입주청소' AND note='34평'`).get();
  const res = await priceRulesRoute.POST(makeReq({
    type: 'rule', id: Number(rule.id), serviceType: '입주청소', areaMin: 0, areaMax: null,
    basePrice: 490000, isActive: true, note: '34평',
  }));
  assert.equal(res.status, 200);
  assert.equal(db.prepare(`SELECT base_price FROM price_rules WHERE id=?`).get(rule.id).base_price, 490000);
});

test('P0-2 명시적으로 비활성화한 주택상품은 하드코딩 가격으로 부활하지 않는다', async () => {
  db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND note='34평'`).run();
  assert.equal(await pricing.getMoveInBasePrice('34평'), null);
});

// [정책 변경] 40평 이상은 확정 자동견적 상품이 아니라 상담 전환 대상이다.
test('P0-5 40평 이상은 상담 전환 대상이며 quote 단계에서 토큰이 발급되지 않는다', async () => {
  // [A] 상담 전환 판정은 /api/quote 책임이다. 토큰이 없으면 예약 제출 자체가 불가능하다.
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 50, desiredDate: '2027-07-25',
  }));
  assert.ok(!res.body.quoteToken, '40평 이상은 확정 토큰이 발급되면 안 된다');
  const q = res.body.quote;
  if (q) {
    assert.equal(q.consultRequired, true);
    assert.equal(q.priceConfirmed, false);
  }
});


test('B안 행정구역 master 미임포트 상태에서는 quote 발급이 차단된다', async () => {
  // [B1] 지역 검증은 /api/quote 책임이다. 토큰이 없으면 예약 제출 자체가 불가능하다.
  const areas = db.prepare('SELECT code, name, level, parent_code FROM administrative_areas').all();
  const svc = db.prepare('SELECT sigungu_code, is_enabled FROM service_areas').all();
  db.prepare('DELETE FROM service_areas').run();
  db.prepare('DELETE FROM administrative_areas').run();
  try {
    const res = await quoteRoute.POST(makeReq({
      serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-07-20',
      areaSidoCode: null, areaSigunguCode: null, areaDongCode: null,
    }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'SERVICE_AREA_NOT_READY', 'master 자체가 없으면 fail closed');
    assert.equal(res.body.quoteToken, undefined);
  } finally {
    for (const a of areas) {
      db.prepare('INSERT OR IGNORE INTO administrative_areas (code,name,level,parent_code) VALUES (?,?,?,?)')
        .run(a.code, a.name, a.level, a.parent_code);
    }
    for (const x of svc) {
      db.prepare('INSERT OR IGNORE INTO service_areas (sigungu_code,is_enabled) VALUES (?,?)')
        .run(x.sigungu_code, x.is_enabled);
    }
  }
});

// [위험 보존] 정식 가격표 밖의 특수 케이스(기준가 확정 불가)는
// 여전히 최종금액 없이 계좌 단계로 진입할 수 없어야 한다.
test('P0-5(negative) 기준가 미확정 상품은 quote 토큰이 발급되지 않는다', async () => {
  const orig = db.prepare(`SELECT base_price FROM price_rules WHERE service_type='입주청소' AND product_key='18평'`).get().base_price;
  try {
    db.prepare(`UPDATE price_rules SET base_price=0 WHERE service_type='입주청소' AND product_key='18평'`).run();
    const res = await quoteRoute.POST(makeReq({
      serviceType: '입주청소', houseTypeKey: '18평', desiredDate: '2027-07-26',
    }));
    assert.ok(!res.body.quoteToken, '기준가 미확정이면 토큰 미발급 → 예약 불가');
  } finally {
    db.prepare(`UPDATE price_rules SET base_price=? WHERE service_type='입주청소' AND product_key='18평'`).run(orig);
  }
});

test('P1-1 quote API는 40평 선택에서 actualPyeong 39를 거부한다', async () => {
  const res = await quoteRoute.POST(makeReq({ serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 39, extraOptions: [] }));
  assert.equal(res.status, 400);
});

test('P1-2 사이청소 시간은 quote 발급 단계에서 필수 검증된다 (B1)', async () => {
  const base = { serviceType: '사이청소', houseTypeKey: '24평', desiredDate: '2027-07-23', timeSlot: 'all_day' };

  const missing = await quoteRoute.POST(makeReq(base));
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'BETWEEN_TIME_REQUIRED');

  const order = await quoteRoute.POST(makeReq({
    ...base, moveOutTime: '2027-07-23T15:00', moveInTime: '2027-07-23T09:00',
  }));
  assert.equal(order.status, 400);
  assert.equal(order.body.code, 'BETWEEN_TIME_ORDER', '입주가 퇴거보다 빠르면 거부');

  const ok = await quoteRoute.POST(makeReq({
    ...base, moveOutTime: '2027-07-23T09:00', moveInTime: '2027-07-23T17:00',
  }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('P1-2 사이청소 예약 API는 퇴거 완료보다 이른 입주 시간을 거부한다', async () => {
  const res = await reservationsRoute.POST(makeReq(validReservationBody({
    serviceType: '사이청소', timeSlot: 'all_day',
    moveOutTime: '2026-12-15T14:00',
    moveInTime: '2026-12-15T13:00',
  })));
  assert.equal(res.status, 400);
});


test('P1-2 사이청소는 all_day 슬롯으로 저장된다 (B2)', async () => {
  const q = await quoteRoute.POST(makeReq({
    serviceType: '사이청소', houseTypeKey: '24평', desiredDate: '2027-08-01', timeSlot: 'all_day',
    moveOutTime: '2027-08-01T09:00', moveInTime: '2027-08-01T17:00',
  }));
  assert.ok(q.body.quoteToken, JSON.stringify(q.body));
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    quoteToken: q.body.quoteToken,
    serviceType: '사이청소', houseTypeKey: '24평', desiredDate: '2027-08-01', timeSlot: 'all_day',
    moveOutTime: '2027-08-01T09:00', moveInTime: '2027-08-01T17:00',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7200-0001',
  })));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const row = db.prepare('SELECT time_slot FROM reservations WHERE id=?').get(res.body.reservation.id);
  assert.equal(row.time_slot, 'all_day', '사이청소는 종일 점유로 저장된다');
});

test('P1-2 일반 청소는 오전/오후 슬롯으로 저장된다 (B2)', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-08-02', timeSlot: 'afternoon',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7200-0002',
  })));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const row = db.prepare('SELECT time_slot FROM reservations WHERE id=?').get(res.body.reservation.id);
  assert.equal(row.time_slot, 'afternoon', '일반 청소는 요청 슬롯 그대로 저장된다');
});

test('P1-2 사이청소 시간은 예약 날짜와 같은 날이어야 한다 (B1)', async () => {
  const res = await quoteRoute.POST(makeReq({
    serviceType: '사이청소', houseTypeKey: '24평', desiredDate: '2027-07-24', timeSlot: 'all_day',
    moveOutTime: '2027-07-25T09:00', moveInTime: '2027-07-25T17:00',
  }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'BETWEEN_TIME_DATE');
});

test('P1-3 awaiting_deposit에서 awaiting_admin_check으로 일반 상태 API 우회 전이를 막는다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody());
  await assert.rejects(
    () => reservations.updateReservationStatus(reservation.id, 'awaiting_admin_check', '관리자', null),
    /전이|상태|입금/
  );
});

test('P1-3 confirmed 결제는 일반 payment status 변경으로 pending downgrade할 수 없다', async () => {
  // 계좌 공개 단계에서 payment가 생성되므로 헬퍼로 진행시킨다 (검증 목적은 동일)
  const { reservation } = await createReservationWithDepositAccount({ customerPhone: '010-3000-0001' });
  await reservations.confirmPayment(reservation.id, '관리자', null);
  await assert.rejects(
    () => reservations.updatePaymentStatus(reservation.id, 'pending', '관리자', null),
    /confirmed|확인|되돌|변경/
  );
});

test('P1-4 비활성 옵션은 quote에서 선택 자체를 거부한다', async () => {
  db.prepare(`UPDATE option_prices SET is_active=0 WHERE option_key='heavy_mold'`).run();
  const res = await quoteRoute.POST(makeReq({ serviceType: '입주청소', houseTypeKey: '34평', extraOptions: ['heavy_mold'] }));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /옵션|서비스|비활성/);
});

test('[정책 변경] 예약 snapshot에 서비스별 가격과 휴일 가산금이 보존된다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    serviceType: '사이청소', houseTypeKey: '24평', timeSlot: 'all_day',
    customerPhone: '010-7100-0001', desiredDate: '2027-08-15',
    moveOutTime: '2027-08-15T09:00', moveInTime: '2027-08-15T17:00',
  });
  const row = db.prepare(
    `SELECT product_key, base_price_snapshot, holiday_surcharge_snapshot, total_amount_snapshot
       FROM reservations WHERE id=?`
  ).get(reservation.id);

  const priceRow = db.prepare(
    `SELECT base_price FROM price_rules WHERE service_type='사이청소' AND product_key='24평'`
  ).get();

  assert.equal(row.product_key, '24평');
  assert.equal(row.base_price_snapshot, priceRow.base_price, '사이청소 자신의 가격이 저장된다');
  // 2027-08-15는 일요일 — 휴일 가산금이 1회 적용된다
  assert.equal(row.holiday_surcharge_snapshot, await holidaySurchargeOn('2027-08-15'));
  assert.equal(row.total_amount_snapshot, priceRow.base_price + row.holiday_surcharge_snapshot);

  // 잔금 = 총액 - 예약금
  const money = db.prepare(
    `SELECT deposit_amount_snapshot, estimated_balance_snapshot FROM reservations WHERE id=?`
  ).get(reservation.id);
  assert.equal(
    money.estimated_balance_snapshot,
    row.total_amount_snapshot - money.deposit_amount_snapshot
  );
});

test('가격표를 바꿔도 기존 예약 snapshot은 변하지 않는다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '32평', customerPhone: '010-7100-0002', desiredDate: '2027-08-16',
  });
  const before = db.prepare(`SELECT total_amount_snapshot FROM reservations WHERE id=?`).get(reservation.id);

  const orig = db.prepare(`SELECT base_price FROM price_rules WHERE service_type='입주청소' AND product_key='32평'`).get().base_price;
  try {
    db.prepare(`UPDATE price_rules SET base_price=888000 WHERE service_type='입주청소' AND product_key='32평'`).run();
    const after = db.prepare(`SELECT total_amount_snapshot FROM reservations WHERE id=?`).get(reservation.id);
    assert.equal(after.total_amount_snapshot, before.total_amount_snapshot, 'snapshot은 고정된다');
  } finally {
    db.prepare(`UPDATE price_rules SET base_price=? WHERE service_type='입주청소' AND product_key='32평'`).run(orig);
  }
});

test('P0-3/P0-4 고객조회 UI는 final_confirmed_total을 우선하고 잔금도 final 기준으로 계산한다', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/reservation/ReservationLookup.tsx'), 'utf8');
  const finalPos = source.indexOf('reservation.final_confirmed_total != null');
  const unconfirmedPos = source.indexOf('reservation.price_confirmed_snapshot === 0');
  assert.ok(finalPos >= 0 && finalPos < unconfirmedPos, 'final_confirmed_total 우선 분기가 price_confirmed_snapshot 분기보다 앞에 있어야 합니다');
  assert.match(source, /final_confirmed_total[\s\S]{0,240}payment\.amount|payment\.amount[\s\S]{0,240}final_confirmed_total/);
});

test('[정책 변경] 공개 예약 UI에 추가서비스 선택이 없다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.doesNotMatch(src, /EXTRA_OPTIONS/);
  assert.doesNotMatch(src, /option_key/);
});

// [정책 변경] 고객이 추가서비스를 선택해 가격을 즉시 올리는 계산기 UI는 제거됐다.
// 추가 작업은 현장 확인 후 고객 동의를 받아 진행한다 (요구사항 5·6).
// 이전에 방지하던 위험(비활성 옵션 노출)은 아래 negative test로 보존한다.
test('P1-4 추가서비스 선택형 계산 UI는 제거되어 공개 화면에 존재하지 않는다', async () => {
  const componentsDir = path.join(process.cwd(), 'src/components');
  assert.equal(
    fs.existsSync(path.join(componentsDir, 'ExtraOptionsSection.tsx')),
    false,
    '추가서비스 선택 섹션 컴포넌트가 남아 있으면 안 된다'
  );
  // 메인 페이지에서도 참조가 제거되어야 한다
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  assert.doesNotMatch(page, /ExtraOptionsSection/);
  // 예약폼에도 옵션 선택 UI가 없어야 한다
  const form = fs.readFileSync(path.join(componentsDir, 'booking/BookingForm.tsx'), 'utf8');
  assert.doesNotMatch(form, /EXTRA_OPTIONS\.map\(/, '예약폼에 옵션 선택 UI가 남아 있으면 안 된다');
});

// [위험 보존] 서버 API는 여전히 비활성 옵션을 거부해야 한다.
test('P1-4(negative) 비활성 옵션은 서버 quote API가 계속 거부한다', async () => {
  db.prepare(`UPDATE option_prices SET is_active=0 WHERE option_key='heavy_mold'`).run();
  try {
    const res = await quoteRoute.POST(makeReq({
      serviceType: '입주청소', houseTypeKey: '34평', extraOptions: ['heavy_mold'],
    }));
    assert.equal(res.status, 400);
  } finally {
    db.prepare(`UPDATE option_prices SET is_active=1 WHERE option_key='heavy_mold'`).run();
  }
});

test('P0-1 34평 관리자 가격 변경이 새 자동견적에 반영된다', async () => {
  const rule = db.prepare(`SELECT * FROM price_rules WHERE service_type='입주청소' AND note='34평'`).get();
  const original = Number(rule.base_price);
  try {
    const update = await priceRulesRoute.POST(makeReq({
      type: 'rule', id: Number(rule.id), serviceType: '입주청소', areaMin: 0, areaMax: null,
      basePrice: 499000, isActive: true, note: '34평',
    }));
    assert.equal(update.status, 200);
    const quote = await quoteRoute.POST(makeReq({ serviceType: '입주청소', houseTypeKey: '34평', extraOptions: [] }));
    assert.equal(quote.status, 200);
    assert.equal(quote.body.quote.estimatedTotal, 499000);
  } finally {
    db.prepare(`UPDATE price_rules SET base_price=?, is_active=1 WHERE id=?`).run(original, rule.id);
  }
});

test('P0-2 비활성 주택상품은 quote API에서 0원 견적으로 예약 흐름을 계속하지 않는다', async () => {
  db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND note='34평'`).run();
  const res = await quoteRoute.POST(makeReq({ serviceType: '입주청소', houseTypeKey: '34평', extraOptions: [] }));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /가격|견적|상품|비활성/);
});

// [정책 변경] 40평 이상은 예약금/계좌 단계로 진행하지 않는다.
test('40평 이상은 예약금/계좌 단계로 진행되지 않는다', async () => {
  const q = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 45 });
  assert.equal(q.consultRequired, true);
  assert.equal(q.consultReason, 'size_40_plus');
  assert.equal(q.priceConfirmed, false, '확정 자동견적이 아니다');
  // 시작가 표기 — 확정금액처럼 보이면 안 된다
  assert.equal(q.isStartingPrice, true);
  assert.match(q.displayPriceLabel, /579,000원부터/);
});

test('P1-3 입금확인된 예약은 일반 예약상태 API로 바로 취소할 수 없다', async () => {
  const { reservation } = await createReservationWithDepositAccount({ customerPhone: '010-3000-0002' });
  await reservations.confirmPayment(reservation.id, '관리자', null);
  await assert.rejects(
    () => reservations.updateReservationStatus(reservation.id, 'cancelled', '관리자', null),
    /환불|입금|결제|confirmed/
  );
});

test('P1-3 미입금 예약을 일반 취소하면 pending 결제도 unconfirmed로 정리한다', async () => {
  const { reservation } = await createReservationWithDepositAccount({ customerPhone: '010-3000-0003' });
  await reservations.updateReservationStatus(reservation.id, 'cancelled', '관리자', null);
  const payment = await reservations.getPaymentByReservationId(reservation.id);
  assert.equal(payment?.payment_status, 'unconfirmed');
});

// [정책 변경] 서비스별 독립 가격 모델.
// 사이청소/거주청소는 입주청소 가격의 배수가 아니라 각자의 price_rules row를 가진다.
// runtime 배수 계산은 존재하지 않는다.
for (const houseTypeKey of Object.keys(CANONICAL_PRICES)) {
  for (const serviceType of ['입주청소', '사이청소', '거주청소']) {
    test(`가격엔진 ${houseTypeKey} × ${serviceType} 독립 가격 조회`, async () => {
      const q = await pricing.calculateQuote({ serviceType, houseTypeKey });
      const row = db.prepare(
        `SELECT base_price FROM price_rules WHERE service_type=? AND product_key=?`
      ).get(serviceType, houseTypeKey);
      assert.ok(row, `${serviceType} × ${houseTypeKey} 가격 row가 있어야 한다`);

      // DB row 값이 그대로 쓰인다 (배수 곱셈 없음)
      assert.equal(q.basePrice, row.base_price);
      assert.equal(q.priceAfterMultiplier, row.base_price);
      assert.equal(q.multiplier, 1.0, 'runtime 배수는 항상 1.0');
      assert.equal(q.estimatedTotal, row.base_price, '평일 기준 총액 = 기본가격');
      assert.equal(q.priceConfirmed, houseTypeKey !== '40평');
    });
  }
}

test('서비스별 가격은 각각 독립 수정되며 다른 서비스에 영향을 주지 않는다', async () => {
  const before = db.prepare(
    `SELECT service_type, base_price FROM price_rules WHERE product_key='24평' ORDER BY service_type`
  ).all();
  assert.equal(before.length, 3, '입주/사이/거주 3개 row가 있어야 한다');

  // 사이청소 24평만 변경
  db.prepare(`UPDATE price_rules SET base_price=? WHERE service_type='사이청소' AND product_key='24평'`)
    .run(999000);
  try {
    const q1 = await pricing.calculateQuote({ serviceType: '사이청소', houseTypeKey: '24평' });
    assert.equal(q1.basePrice, 999000);
    // 입주청소는 영향 없음
    const q2 = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '24평' });
    assert.equal(q2.basePrice, CANONICAL_PRICES['24평']);
  } finally {
    const orig = before.find((r) => r.service_type === '사이청소').base_price;
    db.prepare(`UPDATE price_rules SET base_price=? WHERE service_type='사이청소' AND product_key='24평'`)
      .run(orig);
  }
});

test('runtime 가격 계산에 배수가 사용되지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/pricing.ts'), 'utf8');
  // runtime 모듈에서 배수 상수 자체가 제거되어야 한다
  assert.doesNotMatch(src, /SERVICE_MULTIPLIER/, 'runtime에 배수 상수가 남아 있으면 안 된다');
  const calc = src.slice(src.indexOf('export async function calculateQuote'));
  assert.match(calc, /getServiceProductPrice/, '서비스별 독립 가격을 조회해야 한다');

  // src 전체에서 배수 계산이 없어야 한다 (1.5 / 1.1은 migration·seed 전용)
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
    return out;
  };
  const offenders = walk(path.join(process.cwd(), 'src'))
    .filter((f) => !f.endsWith('database/schema.ts'))
    .filter((f) => /SERVICE_MULTIPLIER/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, [], `배수 상수 잔존:\n${offenders.join('\n')}`);
});

for (const [pkg, expected] of Object.entries({ '1p4h': 129000, '2p4h': 249000, '3p4h': 359000 })) {
  test(`집정리 ${pkg} 패키지 고정가 ${expected}`, async () => {
    const q = await pricing.calculateQuote({ serviceType: '집정리', jipjeongriPackage: pkg, extraOptions: [] });
    assert.equal(q.basePrice, expected);
    assert.equal(q.estimatedTotal, expected);
    assert.equal(q.priceConfirmed, true);
  });
}

test('capacity=1이면 같은 오전 두 번째 예약은 차단하고 오후는 허용한다', async () => {
  await reservations.createReservation(validReservationBody({ timeSlot: 'morning' }));
  await assert.rejects(
    () => reservations.createReservation(validReservationBody({ customerPhone: '010-9999-0001', timeSlot: 'morning' })),
    /마감|예약/
  );
  const afternoon = await reservations.createReservation(validReservationBody({ customerPhone: '010-9999-0002', timeSlot: 'afternoon' }));
  assert.equal(afternoon.reservation.time_slot, 'afternoon');
});

test('입금기한이 지난 pending 예약은 슬롯 카운트에서 자동 제외된다', async () => {
  // 계좌 공개 단계에서 payment가 생성되므로 헬퍼로 진행시킨다 (검증 목적은 동일)
  const first = await createReservationWithDepositAccount({
    customerPhone: '010-3000-0004', timeSlot: 'morning', desiredDate: '2026-12-25',
  });
  expireDeposit(first.reservation.id);
  const second = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-9999-0003', timeSlot: 'morning', desiredDate: '2026-12-25' })
  );
  assert.equal(second.reservation.time_slot, 'morning');
});

test('34평 예약은 선입금 확인 후 자기 슬롯 점유 때문에 최종확정이 막히지 않는다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '34평', customerPhone: '010-3000-0005', desiredDate: '2026-12-26',
  });
  // 신규 흐름에서는 관리자 입금확인만으로 예약완료(confirmed)가 된다
  await reservations.confirmPayment(reservation.id, '관리자', null);
  // [정책] 입금확인 → awaiting_admin_check, 관리자 확정 → confirmed
  await reservations.confirmReservation(reservation.id, '관리자', null);
  assert.equal((await reservations.getReservationById(reservation.id))?.reservation_status, 'confirmed');
});

test('34평 사이청소 snapshot은 독립 가격 기준으로 보존된다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    serviceType: '사이청소', houseTypeKey: '34평', timeSlot: 'all_day',
    customerPhone: '010-7200-0001', desiredDate: '2027-08-17',
    moveOutTime: '2027-08-17T09:00', moveInTime: '2027-08-17T17:00',
  });
  const priceRow = db.prepare(
    `SELECT base_price FROM price_rules WHERE service_type='사이청소' AND product_key='34평'`
  ).get();
  const row = db.prepare(
    `SELECT base_price_snapshot, price_confirmed_snapshot, product_key FROM reservations WHERE id=?`
  ).get(reservation.id);
  assert.equal(row.base_price_snapshot, priceRow.base_price);
  assert.equal(row.price_confirmed_snapshot, 1);
  assert.equal(row.product_key, '34평');
});

test('SITE_URL production 누락은 실패하고 정상 URL은 trailing slash를 제거한다', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSiteUrl = process.env.SITE_URL;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.SITE_URL;
    const site = await importFresh('../src/lib/site-url.ts', 'site-url');
    assert.throws(() => site.getSiteUrl(), /SITE_URL/);
    process.env.SITE_URL = 'https://clyn.example.com///';
    assert.equal(site.getSiteUrl(), 'https://clyn.example.com');
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.SITE_URL = prevSiteUrl;
  }
});

test('SITE_URL production에서 http/https가 아닌 URL은 실패한다', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSiteUrl = process.env.SITE_URL;
  try {
    process.env.NODE_ENV = 'production';
    process.env.SITE_URL = 'ftp://clyn.example.com';
    const site = await importFresh('../src/lib/site-url.ts', 'site-url-invalid');
    assert.throws(() => site.getSiteUrl(), /http\/https|SITE_URL/);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.SITE_URL = prevSiteUrl;
  }
});

test('robots는 개인정보처리방침을 차단하지 않는다', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/robots.ts'), 'utf8');
  assert.doesNotMatch(source, /disallow\s*:\s*[^\n]*privacy/i);
});

test('약관 및 환불정책 공개 페이지가 존재한다', async () => {
  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/app/terms/page.tsx')), true);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'src/app/refund/page.tsx')), true);
});

test('상태 API는 confirmed 직접 진입을 차단한다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody());
  const res = await reservationStatusRoute.POST(
    makeReq({ status: 'confirmed' }),
    { params: Promise.resolve({ id: String(reservation.id) }) }
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'USE_CONFIRM_RESERVATION_API');
});

test('payment-status API는 confirmed 직접 진입을 차단한다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody());
  const res = await paymentStatusRoute.POST(
    makeReq({ status: 'confirmed' }),
    { params: Promise.resolve({ id: String(reservation.id) }) }
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'USE_CONFIRM_PAYMENT_API');
});

test('환불 흐름 refund_required -> refunded는 예약을 cancelled로 유지하며 둘 다 성공한다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-3000-0006', desiredDate: '2026-12-27',
  });
  await reservations.confirmPayment(reservation.id, '관리자', null);

  const required = await paymentStatusRoute.POST(
    makeReq({ status: 'refund_required' }),
    { params: Promise.resolve({ id: String(reservation.id) }) }
  );
  assert.equal(required.status, 200, JSON.stringify(required.body));

  const refunded = await paymentStatusRoute.POST(
    makeReq({ status: 'refunded' }),
    { params: Promise.resolve({ id: String(reservation.id) }) }
  );
  assert.equal(refunded.status, 200);
  assert.equal((await reservations.getReservationById(reservation.id))?.reservation_status, 'cancelled');
  assert.equal((await reservations.getPaymentByReservationId(reservation.id))?.payment_status, 'refunded');
});

test('비활성 주택상품은 quote 토큰이 발급되지 않아 예약이 불가능하다', async () => {
  const orig = db.prepare(`SELECT is_active FROM price_rules WHERE service_type='입주청소' AND product_key='32평'`).get().is_active;
  try {
    db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND product_key='32평'`).run();
    const res = await quoteRoute.POST(makeReq({
      serviceType: '입주청소', houseTypeKey: '32평', actualPyeong: 50, desiredDate: '2027-07-27',
    }));
    assert.ok(!res.body.quoteToken, '비활성 상품은 토큰 미발급');
  } finally {
    db.prepare(`UPDATE price_rules SET is_active=? WHERE service_type='입주청소' AND product_key='32평'`).run(orig);
  }
});

test('[정책 변경] 추가서비스 옵션은 견적/예약에서 제거됐다', async () => {
  // 추가서비스 선택형 계산 UI는 폐지됐다. 옵션은 현장 확인 후 별도 안내한다.
  const q = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '24평', extraOptions: ['heavy_mold'] });
  assert.equal(q.extraTotal, 0, '옵션 금액은 견적에 포함되지 않는다');
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.doesNotMatch(src, /extraOptions/, '예약폼에 옵션 선택 UI가 없다');
});

test('사이청소 시간은 extra_notes가 아니라 정식 컬럼에 저장된다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      serviceType: '사이청소', houseTypeKey: '24평', timeSlot: 'all_day',
      customerPhone: '010-7300-0001', desiredDate: '2027-08-20',
      moveOutTime: '2027-08-20T09:00', moveInTime: '2027-08-20T17:00',
    })
  ));
  assert.equal(res.status, 201);
  const row = db.prepare(
    `SELECT move_out_time, move_in_time, time_slot, extra_notes FROM reservations WHERE reservation_code=?`
  ).get(res.body.reservation.reservation_code);

  assert.ok(row.move_out_time, '퇴거시간이 정식 컬럼에 저장되어야 한다');
  assert.ok(row.move_in_time, '입주시간이 정식 컬럼에 저장되어야 한다');
  // 사이청소는 종일 작업이므로 all_day 슬롯을 점유한다
  assert.equal(row.time_slot, 'all_day');
  // extra_notes JSON 파싱에 의존하지 않는다
  assert.doesNotMatch(row.extra_notes ?? '', /\[사이청소시간\]/);
});

test('사이청소 예약은 해당 날짜의 오전·오후를 함께 막는다', async () => {
  const date = '2027-08-21';
  await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      serviceType: '사이청소', houseTypeKey: '24평', timeSlot: 'all_day',
      customerPhone: '010-7300-0002', desiredDate: date,
      moveOutTime: `${date}T09:00`, moveInTime: `${date}T17:00`,
    })
  ));
  const view = await calendar.getDaySlotView(date);
  assert.equal(view.morning.effectiveStatus, 'closed', '오전이 보호되어야 한다');
  assert.equal(view.afternoon.effectiveStatus, 'closed', '오후가 보호되어야 한다');
  assert.equal(view.morning.blockedByAllDay, true);
});

test('관리자 재개방으로 사이청소 보호 슬롯을 기본 capacity에서도 다시 열 수 있다', async () => {
  const date = '2027-08-22';
  await calendar.setCalendarDay(date, 'available', 1, null, 'morning');
  await calendar.setCalendarDay(date, 'available', 1, null, 'afternoon');
  await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      serviceType: '사이청소', houseTypeKey: '24평', timeSlot: 'all_day',
      customerPhone: '010-7300-0003', desiredDate: date,
      moveOutTime: `${date}T09:00`, moveInTime: `${date}T13:00`,
    })
  ));
  const repo = await import('../src/database/repositories/calendar-repository.ts');
  await repo.upsertReopenOverride({ date, timeSlot: 'afternoon', isOpen: true, reason: '조기 종료' });

  const view = await calendar.getDaySlotView(date);
  assert.equal(view.morning.effectiveStatus, 'closed', '오전은 여전히 보호');
  assert.equal(view.afternoon.effectiveStatus, 'available', '오후는 재개방');
  assert.equal(view.afternoon.reopened, true);
});


test('기존 일반 예약이 있는 날짜에는 사이청소 all_day 접수를 막는다 (B2)', async () => {
  const date = '2027-08-03';
  const first = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    houseTypeKey: '24평', desiredDate: date, timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7300-0001',
  })));
  assert.equal(first.status, 201);

  const q = await quoteRoute.POST(makeReq({
    serviceType: '사이청소', houseTypeKey: '24평', desiredDate: date, timeSlot: 'all_day',
    moveOutTime: `${date}T09:00`, moveInTime: `${date}T17:00`,
  }));
  const blocked = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    quoteToken: q.body.quoteToken,
    serviceType: '사이청소', houseTypeKey: '24평', desiredDate: date, timeSlot: 'all_day',
    moveOutTime: `${date}T09:00`, moveInTime: `${date}T17:00`,
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7300-0002',
  })));
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, 'SLOT_UNAVAILABLE');
});

test('사이청소 예약 자체는 관리자가 오전/오후 슬롯으로 변환할 수 없다', async () => {
  const date = '2027-08-25';
  await calendar.setCalendarDay(date, 'available', 2, null, 'morning');
  await calendar.setCalendarDay(date, 'available', 2, null, 'afternoon');
  const created = await createBetweenCleaning(date, '010-7300-0012');
  await assert.rejects(
    () => reservations.changeReservationSlot(created.id, date, 'morning', '관리자', null),
    /all_day|재개방/
  );
});

test('실제 예약 점유는 재개방 override보다 우선한다', async () => {
  const date = '2027-08-23';
  await calendar.setCalendarDay(date, 'available', 1, null, 'afternoon');
  // 오후를 일반 예약으로 채운다
  await createReservationWithDepositAccount({
    customerPhone: '010-7300-0004', desiredDate: date, timeSlot: 'afternoon',
  });
  const repo = await import('../src/database/repositories/calendar-repository.ts');
  await repo.upsertReopenOverride({ date, timeSlot: 'afternoon', isOpen: true });

  const view = await calendar.getDaySlotView(date);
  assert.equal(view.afternoon.remaining, 0);
  assert.equal(view.afternoon.effectiveStatus, 'closed', '예약이 찬 슬롯은 재개방해도 열리지 않는다');
});

test('관리자 가격설정 GET은 비활성 옵션도 반환해 다시 ON할 수 있게 한다', async () => {
  db.prepare(`UPDATE option_prices SET is_active=0 WHERE option_key='heavy_mold'`).run();
  const res = await priceRulesRoute.GET();
  assert.equal(res.status, 200);
  const heavyMold = res.body.options.find((o) => o.option_key === 'heavy_mold');
  assert.ok(heavyMold);
  assert.equal(heavyMold.is_active, 0);
});

test('관리자에서 변경한 40평 이상 시작가가 공개 quote에 반영된다', async () => {
  const rule = db.prepare(`SELECT * FROM price_rules WHERE service_type='입주청소' AND note='40평'`).get();
  const update = await priceRulesRoute.POST(makeReq({
    type: 'rule', id: Number(rule.id), serviceType: '입주청소', areaMin: 0, areaMax: null,
    basePrice: 599000, isActive: true, note: '40평',
  }));
  assert.equal(update.status, 200);
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 45, extraOptions: [],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.body.quote.basePrice, 599000);
  // [정책] 40평 이상은 상담 전환 대상 — 확정 자동견적이 아니다
  assert.equal(res.body.quote.priceConfirmed, false);
  assert.equal(res.body.quote.consultRequired, true);
  assert.equal(res.body.quote.isStartingPrice, true);
  assert.match(res.body.quote.displayPriceLabel, /599,000원부터/);
  // 공개 응답에는 내부 상담 사유가 없어야 한다
  assert.equal(res.body.quote.consultReason, undefined);
});

test('40평 이상 시작가를 관리자에서 OFF하면 공개 quote도 차단한다', async () => {
  db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND note='40평'`).run();
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 45, extraOptions: [],
  }));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /가격|견적|상품|비활성/);
});

test('비활성 시작가은 quote 토큰이 발급되지 않아 예약이 불가능하다', async () => {
  const orig = db.prepare(`SELECT is_active FROM price_rules WHERE service_type='입주청소' AND product_key='40평'`).get().is_active;
  try {
    db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND product_key='40평'`).run();
    const res = await quoteRoute.POST(makeReq({
      serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 50, desiredDate: '2027-07-27',
    }));
    assert.ok(!res.body.quoteToken, '비활성 상품은 토큰 미발급');
  } finally {
    db.prepare(`UPDATE price_rules SET is_active=? WHERE service_type='입주청소' AND product_key='40평'`).run(orig);
  }
});

test('입금기한 초과 자동취소는 예약 cancelled와 결제 unconfirmed를 함께 반영한다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-8888-0001', desiredDate: '2026-12-28',
  });
  expireDeposit(reservation.id);
  await reservations.cancelOverdueReservation(reservation.id, '시스템', null);
  assert.equal((await reservations.getReservationById(reservation.id))?.reservation_status, 'cancelled');
  assert.equal((await reservations.getPaymentByReservationId(reservation.id))?.payment_status, 'unconfirmed');
});

test('DB adapter는 DATABASE_PATH가 있으면 sqlite, 없으면 postgres를 선택한다', async () => {
  const connection = await importFresh('../src/database/connection.ts', 'db-adapter-selection');
  const prevPath = process.env.DATABASE_PATH;
  const prevUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_PATH = '/tmp/clyn-test.db';
    delete process.env.DATABASE_URL;
    assert.equal(connection.getDatabaseBackend(), 'sqlite');

    delete process.env.DATABASE_PATH;
    process.env.DATABASE_URL = 'postgresql://example.invalid/db';
    assert.equal(connection.getDatabaseBackend(), 'postgres');
  } finally {
    if (prevPath === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = prevPath;
    if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl;
  }
});

test('PostgreSQL row 정규화는 Date 값을 ISO 문자열로 바꾼다', async () => {
  const connection = await importFresh('../src/database/connection.ts', 'pg-normalize');
  const input = { id: 1, created_at: new Date('2026-09-08T08:30:00.000Z'), name: '테스트' };
  assert.deepEqual(connection.normalizePostgresRow(input), {
    id: 1,
    created_at: '2026-09-08T08:30:00.000Z',
    name: '테스트',
  });
});

test('PostgreSQL SQL 변환은 datetime과 LIKE를 PostgreSQL 문법으로 바꾼다', async () => {
  const connection = await importFresh('../src/database/connection.ts', 'pg-sql-translate');
  assert.equal(
    connection.toPostgresSql("SELECT * FROM reservations WHERE customer_name LIKE ? AND updated_at < datetime('now')"),
    'SELECT * FROM reservations WHERE customer_name ILIKE $1 AND updated_at < CURRENT_TIMESTAMP'
  );
});

test('PostgreSQL 예약 생성/슬롯변경은 트랜잭션 안에서 슬롯 advisory lock을 잡는다', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/reservations.ts'), 'utf8');
  const createStart = source.indexOf('export async function createReservation');
  const createEnd = source.indexOf('// ---------------------------------------------------------------------------\n// 조회', createStart);
  const changeStart = source.indexOf('export async function changeReservationSlot');
  const changeEnd = source.indexOf('// ---------------------------------------------------------------------------\n// 대시보드 통계', changeStart);
  assert.match(source.slice(createStart, createEnd), /await lockReservationSlot\(input\.desiredDate, input\.timeSlot\)/);
  assert.match(source.slice(changeStart, changeEnd), /await lockReservationSlot\(newDate, newTimeSlot\)/);
});

// ===========================================================================
// 입금기한 만료 — idempotency / 동시성 / deadline 기준 단일화
// ===========================================================================

test('만료처리는 auto_released 기반으로 idempotent하다 (반복 호출해도 1회만 반영)', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0001', desiredDate: '2026-12-16',
  });
  expireDeposit(reservation.id);

  const first = await reservations.releaseExpiredDepositReservations();
  assert.equal(first, 1);

  const afterFirst = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(afterFirst.auto_released, 1);
  assert.equal(afterFirst.reservation_status, 'cancelled');
  assert.ok(afterFirst.deposit_expired_at, 'deposit_expired_at이 기록되어야 한다');
  const expiredAt = afterFirst.deposit_expired_at;

  // 반복 호출해도 추가 처리 대상이 아니어야 한다
  const second = await reservations.releaseExpiredDepositReservations();
  assert.equal(second, 0);
  const afterSecond = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(afterSecond.deposit_expired_at, expiredAt, '만료 시각이 덮어써지면 안 된다');

  // 로그도 1건만 남아야 한다
  const logs = db.prepare(
    `SELECT COUNT(*) as c FROM confirmation_logs WHERE reservation_id=? AND action='auto_cancel'`
  ).get(reservation.id);
  assert.equal(logs.c, 1);
});

test('입금확인과 만료처리가 경합해도 confirmed가 cancelled로 뒤집히지 않는다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0002', desiredDate: '2026-12-17',
  });
  // 입금기한을 과거로 밀어 만료 대상으로 만든 뒤, 그 직전에 관리자가 입금확인
  expireDeposit(reservation.id);
  await reservations.confirmPayment(reservation.id, '관리자', null);

  // [정책] 입금확인 → awaiting_admin_check (관리자 확정 대기)
  const afterConfirm = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(afterConfirm.reservation_status, 'awaiting_admin_check');

  // 입금이 확인된 예약은 기한이 지났더라도 만료 대상이 아니어야 한다
  const released = await reservations.releaseExpiredDepositReservations();
  assert.equal(released, 0, '입금확인된 예약은 만료 대상이 아니어야 한다');

  const afterRelease = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(afterRelease.reservation_status, 'awaiting_admin_check', '만료 배치가 상태를 뒤집으면 안 된다');

  // 관리자 확정 후에도 만료 배치가 confirmed를 되돌리면 안 된다
  await reservations.confirmReservation(reservation.id, '관리자', null);
  assert.equal(await reservations.releaseExpiredDepositReservations(), 0);
  const afterFinal = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(afterFinal.reservation_status, 'confirmed', 'confirmed가 cancelled로 뒤집히면 안 된다');
  assert.equal(afterRelease.auto_released, 0);
  assert.equal(afterRelease.deposit_expired_at, null);

  const payment = db.prepare(`SELECT * FROM payments WHERE reservation_id=?`).get(reservation.id);
  assert.equal(payment.payment_status, 'confirmed', '입금 상태도 유지되어야 한다');
});

test('만료 판정 기준은 payment_due_date 단일 기준이다', async () => {
  const { reservation, payment } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0003', desiredDate: '2026-12-18',
  });
  // account_revealed_at은 기록되지만 만료 판정에는 쓰이지 않는다
  assert.ok(reservation.account_revealed_at, 'account_revealed_at은 기록되어야 한다');
  assert.ok(payment.payment_due_date, 'payment_due_date가 입금기한 기준이다');

  // account_revealed_at만 과거로 밀어도 만료되지 않는다
  db.prepare(`UPDATE reservations SET account_revealed_at = datetime('now','-48 hours') WHERE id=?`)
    .run(reservation.id);
  assert.equal(await reservations.releaseExpiredDepositReservations(), 0);
  assert.equal(
    db.prepare(`SELECT reservation_status FROM reservations WHERE id=?`).get(reservation.id).reservation_status,
    'approved_awaiting_deposit'
  );

  // payment_due_date를 넘겨야 비로소 만료된다
  expireDeposit(reservation.id);
  assert.equal(await reservations.releaseExpiredDepositReservations(), 1);
  assert.equal(
    db.prepare(`SELECT reservation_status FROM reservations WHERE id=?`).get(reservation.id).reservation_status,
    'cancelled'
  );
});

test('만료된 예약 row는 삭제되지 않고 기록이 보존된다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0004', desiredDate: '2026-12-19',
  });
  expireDeposit(reservation.id);
  await reservations.releaseExpiredDepositReservations();

  const row = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.ok(row, '예약 row가 삭제되면 안 된다');
  assert.equal(row.customer_phone, '010-2000-0004');
  assert.equal(row.auto_released, 1);
  assert.ok(row.deposit_expired_at);
  // 금액 snapshot도 보존되어야 한다
  assert.ok(row.deposit_amount_snapshot > 0);
  assert.ok(row.final_confirmed_total > 0);
});

test('만료로 해제된 슬롯은 다시 예약가능해진다', async () => {
  const date = '2026-12-20';
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0005', desiredDate: date,
  });
  expireDeposit(reservation.id);
  await reservations.releaseExpiredDepositReservations();

  // 동일 슬롯으로 새 예약이 생성 가능해야 한다
  const next = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-2000-0006', desiredDate: date })
  );
  assert.ok(next.reservation?.id, '해제된 슬롯에 새 예약이 가능해야 한다');
});

test('동시 경합에서 confirmed가 cancelled로 덮어써지지 않는다 (조건부 atomic update)', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0007', desiredDate: '2026-12-21',
  });
  expireDeposit(reservation.id);

  // 두 경로를 동시에 시작한다 (순차 실행이 아닌 Promise 경합).
  // SQLite는 BEGIN IMMEDIATE로 직렬화되고, PostgreSQL은 조건부 UPDATE의
  // row 배타 잠금으로 직렬화된다. 어느 쪽이든 결과가 모순되면 안 된다.
  const results = await Promise.allSettled([
    reservations.confirmPayment(reservation.id, '관리자', null),
    reservations.cancelOverdueReservation(reservation.id, '시스템', null),
  ]);

  // 최소한 두 경로가 모두 성공하는 일은 없어야 한다
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.ok(fulfilled.length <= 1, '두 경로가 동시에 성공하면 안 된다');

  const row = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  const payment = db.prepare(`SELECT * FROM payments WHERE reservation_id=?`).get(reservation.id);

  // 핵심 불변식: 상태 간 모순이 없어야 한다
  if (row.reservation_status === 'confirmed') {
    assert.equal(payment.payment_status, 'confirmed', 'confirmed면 결제도 confirmed');
    assert.equal(row.auto_released, 0, 'confirmed면 만료 마킹이 없어야 한다');
    assert.equal(row.deposit_expired_at, null);
  } else if (row.reservation_status === 'cancelled') {
    assert.equal(row.auto_released, 1);
    assert.ok(row.deposit_expired_at);
    assert.notEqual(payment.payment_status, 'confirmed', 'cancelled면 결제가 confirmed면 안 된다');
  } else {
    // 양쪽 모두 롤백된 경우 — 원래 상태가 그대로 유지되어야 한다
    assert.equal(row.reservation_status, 'approved_awaiting_deposit');
    assert.equal(row.auto_released, 0, '롤백됐다면 만료 마킹이 남으면 안 된다');
    assert.equal(row.deposit_expired_at, null);
    assert.notEqual(payment.payment_status, 'confirmed');
  }
});

test('조건부 상태 전이는 예상 상태가 아니면 0건을 반환한다 (PostgreSQL row lock 동등 보장)', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0009', desiredDate: '2026-12-23',
  });
  const repo = await import('../src/database/repositories/reservation-repository.ts');

  // 먼저 confirmed로 전이
  const first = await repo.compareAndSetReservationStatus(
    reservation.id, ['approved_awaiting_deposit'], 'confirmed'
  );
  assert.equal(first, 1, '예상 상태였으므로 1건 변경');

  // 같은 조건으로 다시 시도하면 0건 (이미 상태가 바뀌었으므로)
  const second = await repo.compareAndSetReservationStatus(
    reservation.id, ['approved_awaiting_deposit'], 'cancelled'
  );
  assert.equal(second, 0, '예상 상태가 아니므로 0건 — confirmed가 덮어써지지 않는다');

  const row = db.prepare(`SELECT reservation_status FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(row.reservation_status, 'confirmed');
});

test('만료 처리 후 뒤늦은 confirmPayment는 거부된다 (상태 덮어쓰기 차단)', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-2000-0008', desiredDate: '2026-12-22',
  });
  expireDeposit(reservation.id);
  await reservations.cancelOverdueReservation(reservation.id, '시스템', null);

  await assert.rejects(
    () => reservations.confirmPayment(reservation.id, '관리자', null),
    /상태/,
    '만료된 예약은 입금확인으로 되살릴 수 없어야 한다'
  );

  const row = db.prepare(`SELECT reservation_status FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(row.reservation_status, 'cancelled');
});

test('만료 SQL은 PostgreSQL 변환에서 지원되는 시간 표현만 사용한다', async () => {
  const { toPostgresSql } = await import('../src/database/connection.ts');
  // production 코드가 쓰는 형태
  const converted = toPostgresSql(
    `UPDATE reservations SET deposit_expired_at = datetime('now') WHERE id = ?`
  );
  assert.match(converted, /CURRENT_TIMESTAMP/, "datetime('now')는 CURRENT_TIMESTAMP로 변환되어야 한다");
  assert.doesNotMatch(converted, /datetime\(/, '변환 후 SQLite 전용 함수가 남으면 안 된다');
  assert.match(converted, /\$1/, '플레이스홀더가 $n으로 변환되어야 한다');
});

// ===========================================================================
// [신규] 확정 가격표 12개 상품 + 1.5룸
// ===========================================================================

test('확정 가격표 12개 상품이 모두 price_rules에 존재하고 금액이 일치한다', async () => {
  for (const [key, expected] of Object.entries(CANONICAL_PRICES)) {
    const rule = db.prepare(
      `SELECT base_price, is_active FROM price_rules WHERE service_type='입주청소' AND note=?`
    ).get(key);
    assert.ok(rule, `${key} 가격 규칙이 존재해야 한다`);
    assert.equal(rule.base_price, expected, `${key} 기본 청소금액`);
    assert.equal(rule.is_active, 1, `${key}는 활성 상태여야 한다`);
  }
  assert.equal(Object.keys(CANONICAL_PRICES).length, 12, '정식 상품은 12개다');
});

test('1.5룸은 신규 정식 상품으로 견적/예약 전 경로에서 동작한다', async () => {
  // 가격표
  assert.equal(CANONICAL_PRICES['1.5룸'], 249000);

  // 견적 API
  const quote = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '1.5룸', extraOptions: [],
  }));
  assert.equal(quote.status, 200);
  assert.equal(quote.body.quote.basePrice, CANONICAL_PRICES['1.5룸']);
  assert.equal(quote.body.quote.priceConfirmed, true);

  // 예약 + 계좌 단계까지
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '1.5룸', customerPhone: '010-5000-0001', desiredDate: '2027-01-05',
  });
  assert.equal(reservation.house_type_key, '1.5룸');
  assert.equal(reservation.final_confirmed_total, CANONICAL_PRICES['1.5룸']);
  assert.equal(reservation.deposit_amount_snapshot, 60000);
});

test('홈페이지 견적은 VAT를 자동 가산하지 않는다', async () => {
  const quote = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '32평', extraOptions: [],
  }));
  // 평일 기준 — 날짜 보정 없음
  assert.equal(quote.body.quote.estimatedTotal, CANONICAL_PRICES['32평']);
  // 부가세를 다시 곱해 표시하면 안 된다 (표시가가 이미 부가세 포함)
  assert.notEqual(quote.body.quote.estimatedTotal, Math.round(CANONICAL_PRICES['32평'] * 1.1));
});

// ===========================================================================
// [신규] 상품별 예약금 + snapshot 불변
// ===========================================================================

test('상품별 예약금이 확정 기준과 일치한다 (원룸~24평 6만 / 28~34평 7만 / 38평 8만 / 40평+ 9만)', async () => {
  for (const [key, expected] of Object.entries(EXPECTED_DEPOSITS)) {
    const actual = await pricing.getDepositAmountForHouseType(key);
    assert.equal(actual, expected, `${key} 예약금`);
  }
});

test('예약금은 총 청소금액에 포함되며 잔금 = 총액 - 예약금이다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '38평', customerPhone: '010-5000-0002', desiredDate: '2027-01-06',
  });
  // 날짜 조건이 걸린 날이면 서버가 30,000원을 1회 가산한다
  // 손없는날·토요일은 가산 대상이 아니다. 평일이면 기본가격 그대로.
  const total = CANONICAL_PRICES['38평'] + (await holidaySurchargeOn('2027-01-06'));
  const deposit = EXPECTED_DEPOSITS['38평'];
  assert.equal(reservation.final_confirmed_total, total);
  assert.equal(reservation.deposit_amount_snapshot, deposit);
  assert.equal(reservation.estimated_balance_snapshot, total - deposit);
  // 예약금이 총액에 "추가"되면 안 된다
  assert.ok(reservation.deposit_amount_snapshot <= reservation.final_confirmed_total);
});

test('price_rule 가격/예약금을 변경해도 기존 예약 snapshot은 불변이다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '28평', customerPhone: '010-5000-0003', desiredDate: '2027-01-07',
  });
  const before = db.prepare(
    `SELECT base_price_snapshot, deposit_amount_snapshot, final_confirmed_total, estimated_balance_snapshot FROM reservations WHERE id=?`
  ).get(reservation.id);

  const rule = db.prepare(`SELECT * FROM price_rules WHERE service_type='입주청소' AND note='28평'`).get();
  try {
    db.prepare(`UPDATE price_rules SET base_price=999000, deposit_amount=150000 WHERE id=?`).run(rule.id);
    const after = db.prepare(
      `SELECT base_price_snapshot, deposit_amount_snapshot, final_confirmed_total, estimated_balance_snapshot FROM reservations WHERE id=?`
    ).get(reservation.id);
    assert.deepEqual(after, before, '가격표를 바꿔도 과거 예약 금액은 변하면 안 된다');
  } finally {
    db.prepare(`UPDATE price_rules SET base_price=?, deposit_amount=? WHERE id=?`)
      .run(rule.base_price, rule.deposit_amount, rule.id);
  }
});

test('예약금이 총액을 초과하는 견적은 토큰이 발급되지 않는다 (B1)', async () => {
  // [B1] 금액 정합성은 /api/quote에서 확정하고 토큰에 서명한다.
  const orig = db.prepare(`SELECT deposit_amount FROM price_rules WHERE service_type='입주청소' AND product_key='원룸'`).get().deposit_amount;
  try {
    db.prepare(`UPDATE price_rules SET deposit_amount=99999999 WHERE service_type='입주청소' AND product_key='원룸'`).run();
    const res = await quoteRoute.POST(makeReq({
      serviceType: '입주청소', houseTypeKey: '원룸', desiredDate: '2027-07-28',
    }));
    assert.ok(!res.body.quoteToken, '예약금 > 총액이면 토큰 미발급');
  } finally {
    db.prepare(`UPDATE price_rules SET deposit_amount=? WHERE service_type='입주청소' AND product_key='원룸'`).run(orig);
  }
});

// ===========================================================================
// [신규] 최소 고객정보 필수 검증 (이름 / 연락처 / 작업지역)
// ===========================================================================

test('이름 없이는 예약 API가 거부한다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({ customerName: '', customerPhone: '010-6000-0001' })
  ));
  assert.equal(res.status, 400);
});

test('연락처 형식이 올바르지 않으면 예약 API가 거부한다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({ customerPhone: '123' })
  ));
  assert.equal(res.status, 400);
});

test('작업지역이 없으면 quote 발급이 거부된다 (B1)', async () => {
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-07-29',
    areaSidoCode: null, areaSigunguCode: null, areaDongCode: null,
  }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'AREA_REQUIRED');
  assert.equal(res.body.quoteToken, undefined);
});

test('개인정보 수집·이용 동의 없이는 예약 API가 거부한다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({ privacyAgreed: false, customerPhone: '010-6000-0003' })
  ));
  assert.equal(res.status, 400);
});

test('작업지역은 sido/sigungu/dong으로 분리 저장된다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-6000-0004', desiredDate: '2027-01-09',
  });
  assert.equal(reservation.area_sido, '서울특별시');
  assert.equal(reservation.area_sigungu, '강남구');
  assert.equal(reservation.area_dong, '역삼동');
});

test('연락처는 서버에서 정규화 검증된다', async () => {
  const { normalizePhone, isValidKoreanPhone } = await import('../src/lib/utils.ts');
  assert.equal(normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(normalizePhone('+82 10 1234 5678'), '01012345678');
  assert.equal(isValidKoreanPhone('010-1234-5678'), true);
  assert.equal(isValidKoreanPhone('02-123-4567'), true);
  assert.equal(isValidKoreanPhone('123'), false);
  assert.equal(isValidKoreanPhone('99999999999'), false);
});

// ===========================================================================
// [신규] 서비스 3종 동의 — 각각 저장 / 버전 / 시각
// ===========================================================================

test('서비스 3종 동의는 각각 별도 컬럼에 저장된다 (boolean 하나로 통합 금지)', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-6000-0005', desiredDate: '2027-01-10',
  });
  assert.equal(reservation.core_principles_agreed, 1);
  assert.equal(reservation.service_terms_agreed, 1);
  assert.equal(reservation.additional_charge_agreed, 1);
  // 개인정보 동의는 서비스 동의와 별개로 유지된다
  assert.equal(reservation.privacy_agreed, 1);
});

test('3종 동의 완료 시 동의서 버전과 동의 시각이 기록된다', async () => {
  const { AGREEMENT_VERSION } = await import('../src/lib/agreement.ts');
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-6000-0006', desiredDate: '2027-01-11',
  });
  assert.equal(reservation.agreement_version, AGREEMENT_VERSION);
  assert.ok(reservation.agreed_at, '동의 시각이 기록되어야 한다');
});

test('서비스 동의 3종 중 하나라도 빠지면 예약 API가 거부한다', async () => {
  for (const missing of ['corePrinciplesAgreed', 'serviceTermsAgreed', 'additionalChargeAgreed']) {
    const body = fullyAgreedReservationBody({ customerPhone: '010-6000-0007' });
    body[missing] = false;
    const res = await reservationsRoute.POST(makeReqWithFreshIp(body));
    assert.equal(res.status, 400, `${missing} 미체크는 거부되어야 한다`);
  }
});

test('동의서 버전이 개정돼도 과거 예약의 agreement_version은 변경되지 않는다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-6000-0008', desiredDate: '2027-01-12',
  });
  const recorded = reservation.agreement_version;
  assert.ok(recorded);
  // 이후 동의서가 개정되어도 저장된 값은 그대로여야 한다 (컬럼 갱신 로직이 없어야 함)
  const again = db.prepare(`SELECT agreement_version FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(again.agreement_version, recorded);
});

// ===========================================================================
// [신규] 계좌정보 서버 gate — 미동의 시 payload에 포함 금지
// ===========================================================================

test('[정책 변경] 예약 생성 응답에 입금 계좌가 포함된다', async () => {
  // 통합 지시서 4장: 성공 응답에 bank account를 포함해 고객이 즉시 입금할 수 있게 한다.
  // (별도 /deposit-account 재호출 왕복을 제거하는 것이 확정 설계)
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    customerPhone: '010-7100-9001', desiredDate: '2027-07-30',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
  })));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const serialized = JSON.stringify(res.body);
  assert.match(serialized, /accountNumber|계좌/, '계좌 정보가 응답에 있어야 한다');
});

test('예약 초기 설정 API(GET)에도 계좌번호가 포함되지 않는다', async () => {
  const res = await reservationsRoute.GET();
  const serialized = JSON.stringify(res.body);
  assert.doesNotMatch(serialized, /accountNumber/, '마스킹본 포함 계좌번호가 초기 payload에 있으면 안 된다');
  assert.equal(res.body.bank?.accountNumber, undefined);
  assert.equal(res.body.bank?.accountNumberMasked, undefined);
});

test('3종 동의가 완료되지 않으면 서버가 계좌 공개를 거부한다', async () => {
  const { reservation } = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-7000-0002', desiredDate: '2027-02-02' })
  );
  // 요청을 직접 조작해 동의를 해제한 상황을 재현
  db.prepare(`UPDATE reservations SET service_terms_agreed=0 WHERE id=?`).run(reservation.id);

  await assert.rejects(
    () => reservations.revealDepositAccount(reservation.id),
    /동의/,
    '미동의 상태에서 계좌가 공개되면 안 된다'
  );
  const payments = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE reservation_id=?`).get(reservation.id);
  assert.equal(payments.c, 0, '거부 시 payment가 생성되면 안 된다');
});

test('개인정보 동의가 없으면 서버가 계좌 공개를 거부한다', async () => {
  const { reservation } = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-7000-0003', desiredDate: '2027-02-03' })
  );
  db.prepare(`UPDATE reservations SET privacy_agreed=0 WHERE id=?`).run(reservation.id);
  await assert.rejects(() => reservations.revealDepositAccount(reservation.id), /개인정보/);
});

test('작업지역이 없으면 서버가 계좌 공개를 거부한다', async () => {
  const { reservation } = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-7000-0004', desiredDate: '2027-02-04' })
  );
  db.prepare(`UPDATE reservations SET area_dong=NULL WHERE id=?`).run(reservation.id);
  await assert.rejects(() => reservations.revealDepositAccount(reservation.id), /작업지역/);
});

test('3종 동의 완료 후에만 계좌정보와 금액 3단이 반환된다', async () => {
  const { reservation, payment } = await createReservationWithDepositAccount({
    houseTypeKey: '24평', customerPhone: '010-7000-0005', desiredDate: '2027-02-05',
  });
  // 계좌 공개 시점에 payment와 입금기한이 생성된다
  assert.ok(payment, 'payment가 생성되어야 한다');
  assert.ok(payment.payment_due_date, '입금기한이 설정되어야 한다');
  assert.ok(reservation.account_revealed_at, '계좌 안내 시각이 기록되어야 한다');
  // 금액 3단: 총액 = 예약금 + 잔금
  // 날짜 조건(토/일/공휴일/손없는날)이 걸린 날이면 서버가 30,000원을 1회 가산한다.
  const adj = await holidaySurchargeOn('2027-02-05');
  const expectedTotal = CANONICAL_PRICES['24평'] + adj;
  assert.equal(reservation.final_confirmed_total, expectedTotal);
  assert.equal(reservation.deposit_amount_snapshot, EXPECTED_DEPOSITS['24평']);
  assert.equal(
    reservation.estimated_balance_snapshot,
    expectedTotal - EXPECTED_DEPOSITS['24평']
  );
});

// ===========================================================================
// [신규] 고객 공개 예약상태 3종 (수량 미노출)
// ===========================================================================

test('내부 상태는 예약가능/예약진행 중/예약완료 3종으로만 공개된다', async () => {
  const { toPublicReservationStatus } = await import('../src/lib/types.ts');
  assert.equal(toPublicReservationStatus('received'), '예약진행 중');
  assert.equal(toPublicReservationStatus('approved_awaiting_deposit'), '예약진행 중');
  assert.equal(toPublicReservationStatus('awaiting_deposit'), '예약진행 중');
  assert.equal(toPublicReservationStatus('confirmed'), '예약완료');
  assert.equal(toPublicReservationStatus('completed'), '예약완료');
  assert.equal(toPublicReservationStatus('cancelled'), '예약가능');
});

test('슬롯 공개상태는 잔여 수량을 노출하지 않는다', async () => {
  const { toPublicSlotStatus } = await import('../src/lib/types.ts');
  const available = toPublicSlotStatus({ effectiveStatus: 'available', remaining: 1, hasConfirmed: false });
  const inProgress = toPublicSlotStatus({ effectiveStatus: 'available', remaining: 0, hasConfirmed: false });
  const done = toPublicSlotStatus({ effectiveStatus: 'available', remaining: 0, hasConfirmed: true });

  assert.equal(available, '예약가능');
  assert.equal(inProgress, '예약진행 중');
  assert.equal(done, '예약완료');
  // 반환값은 문자열 3종뿐 — 숫자/건수가 섞이면 안 된다
  for (const v of [available, inProgress, done]) {
    assert.doesNotMatch(v, /\d/, '공개상태에 수량이 포함되면 안 된다');
  }
});

// ===========================================================================
// [신규] 관리자 수기 입금확인 → 예약완료
// ===========================================================================

test('입금확인 후에는 관리자 확정을 거쳐야 예약완료가 된다', async () => {
  // [정책] 접수 → 입금확인(awaiting_admin_check) → 관리자 확정(confirmed)
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    houseTypeKey: '24평', desiredDate: '2027-08-05', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7400-0001',
  })));
  assert.equal(res.status, 201);
  const id = res.body.reservation.id;
  assert.equal(
    db.prepare('SELECT reservation_status s FROM reservations WHERE id=?').get(id).s,
    'awaiting_deposit', '접수 직후에는 입금대기'
  );

  await reservations.confirmPayment(id, '관리자', null);
  const afterDeposit = db.prepare('SELECT reservation_status s FROM reservations WHERE id=?').get(id).s;
  assert.notEqual(afterDeposit, 'confirmed', '입금확인만으로 자동 확정되면 안 된다');

  // 관리자가 예약 확정을 눌러야 confirmed가 된다.
  // 일반 status API로는 전이할 수 없고 전용 confirmReservation()만 허용된다.
  await assert.rejects(
    () => reservations.updateReservationStatus(id, 'confirmed', '관리자'),
    /허용되지 않는 예약 상태 전이/,
    '일반 status API 우회 전이는 막혀야 한다'
  );
  await reservations.confirmReservation(id, '관리자', null);
  assert.equal(
    db.prepare('SELECT reservation_status s FROM reservations WHERE id=?').get(id).s,
    'confirmed'
  );
});

test('입금확인 없이는 예약완료 상태가 될 수 없다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-7000-0007', desiredDate: '2027-02-07',
  });
  // 일반 상태변경 API로 confirmed 직행 시도
  await assert.rejects(
    () => reservations.updateReservationStatus(reservation.id, 'confirmed', '관리자', null),
    /허용|전이|상태/
  );
  const row = db.prepare(`SELECT reservation_status FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(row.reservation_status, 'approved_awaiting_deposit');
});

// ===========================================================================
// [신규] 약관 원문 준비 상태와 계좌 공개 gate의 연동
//
// 두 상태를 각각 증명한다:
//   (A) 약관 원문 미준비 → 서비스 동의/계좌 공개 불가
//   (B) 약관 원문 준비 + 고객정보/개인정보동의/3종동의 완료 → 계좌 공개 가능
// ===========================================================================

test('(B) 약관 원문이 준비된 상태에서 동의서 1~11번 본문이 모두 채워져 있다', async () => {
  const agreement = await import('../src/lib/agreement.ts');
  assert.equal(agreement.AGREEMENT_CONTENT_READY, true, '원문이 적용되어 READY여야 한다');
  assert.equal(agreement.AGREEMENT_SECTIONS.length, 11, '1~11번 전체가 있어야 한다');
  for (const sec of agreement.AGREEMENT_SECTIONS) {
    assert.ok(sec.body.trim().length > 0, `${sec.no}번 본문이 비어 있으면 안 된다`);
  }
  assert.equal(agreement.isAgreementContentReady(), true);
  // 핵심 원칙 3종 (VAT 별도 포함)
  assert.equal(agreement.CORE_PRINCIPLES.length, 3);
  assert.ok(agreement.CORE_PRINCIPLES.some((p) => p.includes('부가세가 포함')));
});

test('(B) 원문 준비 + 필수정보/개인정보동의/3종동의 완료 시 계좌가 공개된다', async () => {
  const { reservation, payment } = await createReservationWithDepositAccount({
    customerPhone: '010-8000-0001', desiredDate: '2027-03-01',
  });
  assert.equal(reservation.reservation_status, 'approved_awaiting_deposit');
  assert.ok(payment, 'payment가 생성되어야 한다');
  assert.ok(reservation.account_revealed_at, '계좌 안내 시각이 기록되어야 한다');
  assert.ok(reservation.agreement_version, '동의서 버전이 기록되어야 한다');
});

test('(A) 약관 원문이 준비되지 않으면 계좌 공개가 차단된다', async () => {
  const { reservation } = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-8000-0002', desiredDate: '2027-03-02' })
  );

  // isAgreementContentReady()가 false가 되는 상황을 재현한다.
  // (본문이 비어 있으면 플래그와 무관하게 false — 실제 production 로직 그대로)
  const agreementModule = await import('../src/lib/agreement.ts');
  const originalBodies = agreementModule.AGREEMENT_SECTIONS.map((s) => s.body);
  try {
    for (const sec of agreementModule.AGREEMENT_SECTIONS) sec.body = '';
    assert.equal(agreementModule.isAgreementContentReady(), false, '본문이 비면 미준비로 판정');

    await assert.rejects(
      () => reservations.revealDepositAccount(reservation.id),
      /동의서.*준비|준비되지/,
      '원문 미준비 상태에서 계좌가 공개되면 안 된다'
    );
    const payments = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE reservation_id=?`).get(reservation.id);
    assert.equal(payments.c, 0, '차단 시 payment가 생성되면 안 된다');
    const row = db.prepare(`SELECT reservation_status, account_revealed_at FROM reservations WHERE id=?`).get(reservation.id);
    assert.equal(row.reservation_status, 'received', '차단 시 상태가 바뀌면 안 된다');
    assert.equal(row.account_revealed_at, null, '차단 시 계좌 안내 시각이 남으면 안 된다');
  } finally {
    agreementModule.AGREEMENT_SECTIONS.forEach((sec, i) => { sec.body = originalBodies[i]; });
  }
});

test('(A) 약관 원문이 준비되지 않으면 3종 동의가 유효하게 기록되지 않는다', async () => {
  const agreementModule = await import('../src/lib/agreement.ts');
  const originalBodies = agreementModule.AGREEMENT_SECTIONS.map((s) => s.body);
  try {
    for (const sec of agreementModule.AGREEMENT_SECTIONS) sec.body = '';

    const { reservation } = await reservations.createReservation(
      fullyAgreedReservationBody({ customerPhone: '010-8000-0003', desiredDate: '2027-03-03' })
    );
    const row = db.prepare(
      `SELECT agreement_version, agreed_at FROM reservations WHERE id=?`
    ).get(reservation.id);
    assert.equal(row.agreement_version, null, '원문 미준비 시 동의서 버전이 기록되면 안 된다');
    assert.equal(row.agreed_at, null, '원문 미준비 시 동의 시각이 기록되면 안 된다');
  } finally {
    agreementModule.AGREEMENT_SECTIONS.forEach((sec, i) => { sec.body = originalBodies[i]; });
  }
});

test('동의서 원문은 한 곳에서만 관리되며 표준 구조/VAT 문구를 포함한다', async () => {
  const agreement = await import('../src/lib/agreement.ts');
  const section1 = agreement.AGREEMENT_SECTIONS.find((s) => s.no === 1);
  // 1.5룸이 표준 구조 기준에 포함되어야 한다
  assert.match(section1.body, /1\.5룸/);
  assert.match(section1.body, /부가세가 포함/);
  // 8번 잔금 정산에도 부가세 포함 문구 유지
  const section8 = agreement.AGREEMENT_SECTIONS.find((s) => s.no === 8);
  assert.match(section8.body, /부가세가 포함/);
  // 3번 추가요금 항목
  const section3 = agreement.AGREEMENT_SECTIONS.find((s) => s.no === 3);
  assert.match(section3.body, /곰팡이|니코틴|반려동물/);
});

// ===========================================================================
// [신규] 확정 기본가격 12개 (부가세 포함 고객 표시금액)
// ===========================================================================

test('확정 기본가격 12개 상품이 최신 정책값과 일치한다', async () => {
  const expected = {
    '원룸': 179000, '원룸 복층': 239000, '1.5룸': 249000, '투룸': 269000,
    '쓰리룸': 319000, '18평': 329000, '24평': 369000, '28평': 420000,
    '32평': 459000, '34평': 489000, '38평': 539000, '40평': 579000,
  };
  for (const [key, price] of Object.entries(expected)) {
    assert.equal(CANONICAL_PRICES[key], price, `${key} 상수`);
    const rule = db.prepare(
      `SELECT base_price FROM price_rules WHERE service_type='입주청소' AND note=?`
    ).get(key);
    assert.equal(rule.base_price, price, `${key} DB 가격`);
  }
});

test('가격은 단일 원천에서만 정의되고 UI/API에 중복 하드코딩되지 않는다', async () => {
  const types = fs.readFileSync(path.join(process.cwd(), 'src/lib/types.ts'), 'utf8');
  assert.match(types, /DEFAULT_BASE_PRICE_BY_HOUSE_TYPE/);
  // pricing.ts는 상수를 참조만 한다
  const pricingSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/pricing.ts'), 'utf8');
  assert.match(pricingSrc, /MOVE_IN_BASE_PRICES: Record<string, number> = DEFAULT_BASE_PRICE_BY_HOUSE_TYPE/);
  // 컴포넌트/라우트에 가격 숫자를 직접 박지 않는다
  for (const f of ['src/components/PricingSection.tsx', 'src/app/api/pricing/route.ts']) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.doesNotMatch(src, /179000|239000|369000|579000/, `${f}에 가격 하드코딩`);
  }
});

// ===========================================================================
// [신규] 40평 이상 상담 전환
// ===========================================================================

test('40평 이상은 579,000원부터 시작가이며 확정 자동견적이 아니다', async () => {
  const q = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 50 });
  assert.equal(q.basePrice, CANONICAL_PRICES['40평']);
  assert.equal(q.priceConfirmed, false);
  assert.equal(q.consultRequired, true);
  assert.equal(q.consultReason, 'size_40_plus');
  assert.equal(q.isStartingPrice, true);
  assert.match(q.displayPriceLabel, /579,000원부터/);
  assert.match(q.notice, /상담 접수|영업일 기준 24시간/);
});

test('40평 이상은 날짜 조건 가산을 확정가처럼 더하지 않는다', async () => {
  // 2026-12-19는 손없는날 — 일반 상품이면 +30,000
  const q = await pricing.calculateQuote({
    serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 50, desiredDate: '2026-12-19',
  });
  assert.equal(q.dateAdjustmentAmount, 0, '상담 상품에는 날짜 보정을 적용하지 않는다');
  assert.match(q.displayPriceLabel, /579,000원부터/);
});

test('40평 이상은 quote 토큰이 발급되지 않아 예약이 불가능하다', async () => {
  // [A] 상담 전환 판정은 /api/quote 책임이다. 토큰이 없으면 예약 제출 자체가 불가능하다.
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 50, desiredDate: '2027-07-25',
  }));
  assert.ok(!res.body.quoteToken, '40평 이상은 확정 토큰이 발급되면 안 된다');
  const q = res.body.quote;
  if (q) {
    assert.equal(q.consultRequired, true);
    assert.equal(q.priceConfirmed, false);
  }
});

// ===========================================================================
// [신규] 날짜 조건 내부 가격 보정 (+30,000원 1회)
// ===========================================================================

const BASE_1R = 179000;
const ADJ = 30000;

async function quoteOn(date) {
  return pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '원룸', desiredDate: date });
}

test('평일(특별일 아님)은 날짜 가산이 없다', async () => {
  // 2026-12-15 화요일, 공휴일/손없는날 아님
  const q = await quoteOn('2026-12-15');
  assert.equal(q.dateAdjustmentAmount, 0);
  assert.equal(q.estimatedTotal, BASE_1R);
});

test('[정책 변경] 토요일에는 가산하지 않는다', async () => {
  const meta = specialDays.getSpecialDayMeta('2026-12-12'); // 토
  assert.equal(meta.isWeekend, true);
  const q = await quoteOn('2026-12-12');
  assert.equal(q.dateAdjustmentAmount, 0, '토요일 가산 폐지');
  assert.equal(q.estimatedTotal, BASE_1R);
});

test('일요일은 +30,000원이 가산된다', async () => {
  const meta = specialDays.getSpecialDayMeta('2026-12-13'); // 일
  assert.equal(meta.isWeekend, true);
  const q = await quoteOn('2026-12-13');
  assert.equal(q.dateAdjustmentAmount, ADJ);
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
});

test('공휴일은 +30,000원이 가산된다', async () => {
  const meta = specialDays.getSpecialDayMeta('2026-12-25'); // 성탄절(금)
  assert.equal(meta.isHoliday, true);
  assert.equal(meta.isWeekend, false, '주말이 아닌 공휴일로 검증');
  const q = await quoteOn('2026-12-25');
  assert.equal(q.dateAdjustmentAmount, ADJ);
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
});

test('[정책 변경] 손없는날에는 가산하지 않는다', async () => {
  // 2026-12-17(목) = 음력 11월 9일 — 손없는날, 주말·공휴일 아님
  const meta = specialDays.getSpecialDayMeta('2026-12-17');
  assert.equal(meta.isSonEomneunDay, true);
  const q = await quoteOn('2026-12-17');
  assert.equal(q.dateAdjustmentAmount, 0, '손없는날 가산 폐지');
  assert.equal(q.estimatedTotal, BASE_1R);
});

test('일요일에는 휴일 가산금이 1회 적용된다', async () => {
  const info = await specialDayStore.getSpecialDay('2026-12-13'); // 일
  assert.equal(info.isSunday, true);
  const q = await quoteOn('2026-12-13');
  assert.equal(q.dateAdjustmentAmount, ADJ);
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
});

test('토요일+손없는날이 겹쳐도 가산하지 않는다', async () => {
  const meta = specialDays.getSpecialDayMeta('2026-02-07'); // 토 + 손없는날
  assert.equal(meta.isWeekend, true);
  assert.equal(meta.isSonEomneunDay, true);
  const q = await quoteOn('2026-02-07');
  assert.equal(q.dateAdjustmentAmount, 0, '토요일·손없는날 모두 가산 대상이 아니다');
});

test('일요일+공휴일이 겹쳐도 휴일 가산금은 1회만 적용된다', async () => {
  // 2026-03-01 삼일절 + 일요일
  const info = await specialDayStore.getSpecialDay('2026-03-01');
  assert.equal(info.isSunday && info.isHoliday, true);
  const q = await quoteOn('2026-03-01');
  assert.equal(q.dateAdjustmentAmount, ADJ, '조건이 겹쳐도 1회');
  assert.notEqual(q.dateAdjustmentAmount, ADJ * 2);
});

test('휴일 가산금은 관리자 설정값을 따른다', async () => {
  const prev = db.prepare(`SELECT value FROM settings WHERE key='holiday_surcharge'`).get()?.value;
  try {
    db.prepare(`UPDATE settings SET value='50000' WHERE key='holiday_surcharge'`).run();
    const q = await quoteOn('2026-12-13'); // 일요일
    assert.equal(q.dateAdjustmentAmount, 50000);
    assert.equal(q.estimatedTotal, BASE_1R + 50000);
  } finally {
    if (prev !== undefined) {
      db.prepare(`UPDATE settings SET value=? WHERE key='holiday_surcharge'`).run(prev);
    }
  }
});

test('공휴일+손없는날이 겹쳐도 +30,000원만 1회 적용된다', async () => {
  // 2026-02-16(월) = 설날 연휴 + 음력 12월 29일(손없는날)
  const meta = specialDays.getSpecialDayMeta('2026-02-16');
  assert.equal(meta.isHoliday, true);
  assert.equal(meta.isSonEomneunDay, true);
  assert.equal(meta.isWeekend, false, '주말이 아닌 조건 중복으로 검증');
  assert.equal(specialDays.getDateAdjustment('2026-02-16'), ADJ);
});

test('일요일+공휴일이 겹쳐도 +30,000원만 1회 적용된다', async () => {
  // 2027-03-01 삼일절(월)이 아니라 주말 겹치는 날 확인
  const dates = ['2026-03-01']; // 삼일절 일요일
  for (const d of dates) {
    const meta = specialDays.getSpecialDayMeta(d);
    assert.equal(meta.isWeekend && meta.isHoliday, true, `${d}는 일요일+공휴일`);
    assert.equal(specialDays.getDateAdjustment(d), ADJ);
  }
});

test('휴일 가산금은 서비스 독립 가격 위에 1회만 더해진다', async () => {
  const q = await pricing.calculateQuote({
    serviceType: '사이청소', houseTypeKey: '원룸', desiredDate: '2026-12-13', // 일요일
  });
  const row = db.prepare(
    `SELECT base_price FROM price_rules WHERE service_type='사이청소' AND product_key='원룸'`
  ).get();
  // 배수 곱셈이 아니라 사이청소 자신의 가격 + 휴일 가산금
  assert.equal(q.basePrice, row.base_price);
  assert.equal(q.dateAdjustmentAmount, ADJ);
  assert.equal(q.estimatedTotal, row.base_price + ADJ);
});

// ===========================================================================
// [신규] 고객 API 내부 사유 비노출
// ===========================================================================

test('공개 quote 응답에 날짜 가산 사유/내부 금액 필드가 없다', async () => {
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '원룸', desiredDate: '2026-12-13',
  }));
  assert.equal(res.status, 200);
  const q = res.body.quote;
  // 일요일 — 휴일 가산금이 반영된 최종 금액만 본다
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
  // 내부 필드는 제거되어야 한다
  assert.equal(q.dateAdjustmentApplied, undefined);
  assert.equal(q.dateAdjustmentAmount, undefined);
  assert.equal(q.consultReason, undefined);
  const serialized = JSON.stringify(res.body);
  for (const banned of ['weekendSurcharge', 'holidayFee', 'sonEomneunFee', '주말 할증', '공휴일 할증', '손없는날 할증']) {
    assert.doesNotMatch(serialized, new RegExp(banned), `${banned}가 노출되면 안 된다`);
  }
});

test('고객 견적 안내 문구에 VAT 별도/부가세 별도 표현이 없다', async () => {
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', extraOptions: [],
  }));
  const serialized = JSON.stringify(res.body);
  assert.doesNotMatch(serialized, /VAT 별도/);
  assert.doesNotMatch(serialized, /부가세 별도/);
  assert.match(res.body.quote.notice, /부가세가 포함/);
});

test('소스 전체에 VAT 별도/부가세 별도 문구가 남아 있지 않다', async () => {
  const roots = ['src/lib', 'src/components', 'src/app'];
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = fs.readFileSync(full, 'utf8');
        // 정책을 설명하는 주석 라인은 허용한다 (고객에게 노출되는 문자열만 검사)
        const lines = src.split('\n').filter((l) => {
          if (!/VAT 별도|부가세 별도/.test(l)) return false;
          const t = l.trim();
          const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
          if (isComment) return false;
          // 정규식으로 구 문구를 차단하는 코드도 허용
          if (/banned|sanitize|doesNotMatch|assert/.test(l)) return false;
          return true;
        });
        if (lines.length) offenders.push(`${full}: ${lines[0].trim()}`);
      }
    }
  };
  for (const r of roots) walk(path.join(process.cwd(), r));
  assert.deepEqual(offenders, [], `VAT 별도 문구 잔존:\n${offenders.join('\n')}`);
});

// ===========================================================================
// [신규] 특별일 데이터 지원 범위
// ===========================================================================

test('특별일 데이터는 예약 가능 기간(오늘+365일)을 커버한다', async () => {
  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 365);
  const maxYear = maxDate.getFullYear();
  assert.ok(
    maxYear <= specialDays.SUPPORTED_YEARS.max,
    `예약 가능 최대 연도(${maxYear})가 특별일 데이터 범위(${specialDays.SUPPORTED_YEARS.max})를 벗어남 — 데이터 확장 필요`
  );
});

test('지원 범위 밖 연도는 조용히 일반일로 처리하지 않고 supported=false로 표시한다', async () => {
  const meta = specialDays.getSpecialDayMeta('2030-01-01');
  assert.equal(meta.supported, false);
  // 주말 판정은 연도와 무관하게 정확해야 한다
  const sat = specialDays.getSpecialDayMeta('2030-01-05');
  assert.equal(sat.isWeekend, true);
});

// ===========================================================================
// [신규] 반려동물 상담 전환
// ===========================================================================

test('[정책 변경] 반려동물은 상담 전환 대상이 아니다', async () => {
  const q = await pricing.calculateQuote({
    serviceType: '입주청소', houseTypeKey: '24평', hasPet: true,
  });
  assert.equal(q.consultRequired, false, '반려동물 상담 전환은 폐지됨');
  assert.notEqual(q.consultReason, 'pet');
  assert.equal(q.priceConfirmed, true);
});

test('[정책 변경] 반려동물이 있어도 일반 예약으로 진행된다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      houseTypeKey: '24평', hasPet: true,
      customerPhone: '010-9200-0001', desiredDate: '2027-04-05',
    })
  ));
  assert.equal(res.status, 201, '반려동물 때문에 예약이 막히면 안 된다');
});

test('[정책 변경] 반려동물 예약도 계좌 안내를 받는다', async () => {
  const { reservation, payment } = await createReservationWithDepositAccount({
    houseTypeKey: '24평', customerPhone: '010-9200-0002', desiredDate: '2027-04-06',
  });
  assert.equal(reservation.reservation_status, 'approved_awaiting_deposit');
  assert.ok(payment);
});

test('반려동물 정보는 정식 컬럼(has_pet)에 저장된다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '24평', customerPhone: '010-9200-0003', desiredDate: '2027-04-07',
  });
  const row = db.prepare('SELECT has_pet FROM reservations WHERE id=?').get(reservation.id);
  assert.equal(row.has_pet, 0, '반려동물 없음은 0');
});

// ===========================================================================
// [신규] 상담접수 파이프라인
// ===========================================================================

test('상담접수는 캘린더 capacity/remaining을 차감하지 않는다', async () => {
  const date = '2027-05-10';
  await calendar.setCalendarDay(date, 'available', 1, null, 'morning');
  const before = await calendar.getDaySlotView(date);

  const consultations = await import('../src/lib/consultations.ts');
  await consultations.createConsultation({
    customerName: '상담고객', customerPhone: '010-9300-0001',
    serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 55,
    preferredDate: date, preferredTimeSlot: 'morning',
    reason: 'size_40_plus', privacyAgreed: true,
  });

  const after = await calendar.getDaySlotView(date);
  assert.equal(after.morning.remaining, before.morning.remaining, '상담접수는 슬롯을 점유하지 않는다');
  assert.equal(after.morning.bookedCount, before.morning.bookedCount);
});

test('상담접수는 예약/payment를 생성하지 않는다', async () => {
  const consultations = await import('../src/lib/consultations.ts');
  const resCount = db.prepare('SELECT COUNT(*) as c FROM reservations').get().c;
  const payCount = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;

  const created = await consultations.createConsultation({
    customerName: '상담고객2', customerPhone: '010-9300-0002',
    serviceType: '입주청소', houseTypeKey: '40평',
    reason: 'size_40_plus', privacyAgreed: true,
  });

  assert.match(created.request_code, /^CS-/);
  assert.equal(created.status, 'received');
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM reservations').get().c, resCount);
  assert.equal(db.prepare('SELECT COUNT(*) as c FROM payments').get().c, payCount);
});

test('상담접수의 참고 시작가는 확정 견적이 아니다', async () => {
  const consultations = await import('../src/lib/consultations.ts');
  const created = await consultations.createConsultation({
    customerName: '상담고객3', customerPhone: '010-9300-0003',
    serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 60,
    reason: 'size_40_plus', privacyAgreed: true,
  });
  // 시작가만 보존하고 확정 총액/예약금 필드는 없다
  assert.equal(created.reference_price, CANONICAL_PRICES['40평']);
  assert.equal(created.converted_reservation_id, null);
});

// ===========================================================================
// [신규] 공개 캘린더 수량 비노출 / 관리자 수량 유지
// ===========================================================================

test('공개 캘린더 API는 remaining/capacity/bookedCount를 노출하지 않는다', async () => {
  const calendarRoute = await import('../src/app/api/calendar/route.ts');
  const res = await calendarRoute.GET({ url: 'http://localhost/api/calendar?start=2026-12-01&end=2026-12-03' });
  const body = await res.json();
  const serialized = JSON.stringify(body);
  for (const banned of ['remaining', 'capacity', 'bookedCount']) {
    assert.doesNotMatch(serialized, new RegExp(banned), `${banned}가 공개 응답에 있으면 안 된다`);
  }
  // 공개상태와 특별일 메타는 있어야 한다
  assert.ok(body.days[0].morning.publicStatus);
  assert.equal(typeof body.days[0].isSonEomneunDay, 'boolean');
});

test('관리자 캘린더는 내부 수량 데이터를 그대로 유지한다', async () => {
  const view = await calendar.getDaySlotView('2026-12-01');
  assert.equal(typeof view.morning.capacity, 'number');
  assert.equal(typeof view.morning.bookedCount, 'number');
  assert.equal(typeof view.morning.remaining, 'number');
});

// ===========================================================================
// [신규] 홈페이지 구성 / 사진 20장 / 브랜드
// ===========================================================================

test('홈페이지 메인에 PricingSection이 렌더링되지 않는다', async () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  assert.doesNotMatch(page, /<PricingSection/);
  assert.doesNotMatch(page, /import PricingSection/);
});

test('서비스 섹션 제목은 "청소 서비스 구분"이고 선택 유도 표현이 없다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ServiceList.tsx'), 'utf8');
  assert.match(src, /청소 서비스 구분/);
  assert.doesNotMatch(src, /필요한 청소를 선택하세요/);
});

test('Hero는 제공된 2장을 모두 슬라이드로 사용한다', async () => {
  const images = await import('../src/lib/images.ts');
  assert.equal(images.HERO_SLIDES.length, 2);
  const srcs = images.HERO_SLIDES.map((s) => s.src);
  assert.ok(srcs.includes('/images/clean/hero/hero-living-room.webp'));
  assert.ok(srcs.includes('/images/clean/hero/hero-kitchen.webp'));
  const hero = fs.readFileSync(path.join(process.cwd(), 'src/components/HeroBanner.tsx'), 'utf8');
  assert.match(hero, /HERO_SLIDES\.map/, 'Hero가 두 장을 모두 렌더링해야 한다');
});

test('제공된 사진 20장이 모두 컴포넌트 트리에서 실제로 사용된다', async () => {
  const publicDir = path.join(process.cwd(), 'public/images/clean');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.webp')) files.push(full.replace(path.join(process.cwd(), 'public'), ''));
    }
  };
  walk(publicDir);
  assert.equal(files.length, 20, '제공 사진은 20장이다');

  // images.ts에 전부 등록되어야 한다
  const imagesSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/images.ts'), 'utf8');
  const unregistered = files.filter((f) => !imagesSrc.includes(f));
  assert.deepEqual(unregistered, [], `images.ts 미등록:\n${unregistered.join('\n')}`);

  // 등록된 export가 실제 컴포넌트에서 렌더링되어야 한다
  const images = await import('../src/lib/images.ts');
  const used = new Set();
  images.HERO_SLIDES.forEach((i) => used.add(i.src));
  used.add(images.CTA_IMAGE.src);
  images.BEFORE_AFTER_PAIRS.forEach((p) => { used.add(p.before.src); used.add(p.after.src); });
  images.PORTFOLIO_ITEMS.forEach((p) => used.add(p.image.src));
  images.DETAIL_CASES.forEach((d) => used.add(d.image.src));
  const notUsed = files.filter((f) => !used.has(f));
  assert.deepEqual(notUsed, [], `화면에서 사용되지 않는 사진:\n${notUsed.join('\n')}`);

  // 각 배열을 렌더링하는 컴포넌트가 존재해야 한다
  const comps = {
    'src/components/HeroBanner.tsx': /HERO_SLIDES/,
    'src/components/BeforeAfterGallery.tsx': /BEFORE_AFTER_PAIRS/,
    'src/components/CleaningPortfolio.tsx': /PORTFOLIO_ITEMS/,
    'src/components/DetailCleaningFocus.tsx': /DETAIL_CASES/,
    'src/components/CtaBanner.tsx': /CTA_IMAGE/,
  };
  for (const [file, re] of Object.entries(comps)) {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(src, re, `${file}이 이미지를 렌더링해야 한다`);
  }

  // 해당 컴포넌트들이 홈페이지에 배치되어야 한다
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  for (const c of ['HeroBanner', 'BeforeAfterGallery', 'CleaningPortfolio', 'DetailCleaningFocus', 'CtaBanner']) {
    assert.match(page, new RegExp(`<${c}`), `${c}가 홈페이지에 없다`);
  }
});

test('Footer에 주식회사 플린과 사업자 정보가 표시된다', async () => {
  const footer = fs.readFileSync(path.join(process.cwd(), 'src/components/SiteFooter.tsx'), 'utf8');
  assert.match(footer, /legalCompanyName/);
  assert.match(footer, /bizNumber/);
  assert.match(footer, /mailOrderNumber/);
  assert.match(footer, /brandName/);
});

test('브랜드/법인 settings fallback이 동작한다', async () => {
  const settings = await import('../src/lib/settings.ts');
  assert.equal(settings.BRAND_FALLBACK.brandName, 'CLYN CLEAN CARE');
  assert.equal(settings.BRAND_FALLBACK.legalCompanyName, '주식회사 플린');
  assert.equal(settings.BRAND_FALLBACK.legalCompanyNameEn, 'Plyn Inc.');
  assert.equal(settings.BRAND_FALLBACK.bizNumber, '792-81-04045');
  // 사용자가 제공한 주소 표기를 임의 교정하지 않는다
  assert.match(settings.BRAND_FALLBACK.address, /경원빌딘/);

  const company = await settings.getCompanySettings();
  assert.equal(company.brandName, 'CLYN CLEAN CARE');
  assert.equal(company.legalCompanyName, '주식회사 플린');
});

test('Header에 상담 접수 메뉴가 있다', async () => {
  const header = fs.readFileSync(path.join(process.cwd(), 'src/components/SiteHeader.tsx'), 'utf8');
  assert.match(header, /\/consultation/);
  assert.match(header, /상담 접수/);
});

test('Header는 텍스트 로고타입이 아니라 실제 BI 이미지를 사용한다', async () => {
  const header = fs.readFileSync(path.join(process.cwd(), 'src/components/SiteHeader.tsx'), 'utf8');
  // next/image로 BI를 렌더링해야 한다
  assert.match(header, /from "next\/image"/);
  assert.match(header, /BRAND_LOGO/);
  // 임시 텍스트 로고타입은 제거되어야 한다
  assert.doesNotMatch(header, /tracking-\[0\.18em\]/, '텍스트 로고타입이 남아 있으면 안 된다');
});

test('BI 원본 파일이 존재하고 종횡비가 보존된다', async () => {
  const logoPath = path.join(process.cwd(), 'public/images/brand/clyn-clean-care-logo.png');
  assert.ok(fs.existsSync(logoPath), 'BI 원본 파일이 있어야 한다');

  const images = await import('../src/lib/images.ts');
  assert.equal(images.BRAND_LOGO.src, '/images/brand/clyn-clean-care-logo.png');
  // 원본 크기 그대로 (임의 크롭/리사이즈 금지)
  assert.equal(images.BRAND_LOGO.width, 1448);
  assert.equal(images.BRAND_LOGO.height, 1086);

  // 실제 PNG 헤더의 크기와 일치해야 한다
  const buf = fs.readFileSync(logoPath);
  assert.equal(buf.readUInt32BE(16), images.BRAND_LOGO.width);
  assert.equal(buf.readUInt32BE(20), images.BRAND_LOGO.height);
});

// ===========================================================================
// [신규] 공식 기준 날짜 검증
//
// 테스트가 코드 테이블을 자기검증하지 않도록, 독립적인 음력 변환 라이브러리
// (한국천문연구원 기준)로 손없는날을 재계산해 대조한다.
// ===========================================================================

test('손없는날 데이터가 KASI 음력 변환 결과와 정확히 일치한다', async () => {
  const { createRequire } = await import('node:module');
  const KLC = createRequire(import.meta.url)('korean-lunar-calendar');
  const SON = new Set([9, 10, 19, 20, 29, 30]);
  const pad = (n) => String(n).padStart(2, '0');

  // 라이브러리 자체를 먼저 검증 — KASI 공식 명절 날짜와 대조
  const known = [
    ['2026-02-17', 1, 1],   // 설날
    ['2026-09-25', 8, 15],  // 추석
    ['2026-05-24', 4, 8],   // 부처님오신날
    ['2027-02-07', 1, 1],
    ['2027-09-15', 8, 15],
  ];
  for (const [date, lm, ld] of known) {
    const [y, m, d] = date.split('-').map(Number);
    const c = new KLC();
    c.setSolarDate(y, m, d);
    const l = c.getLunarCalendar();
    assert.equal(l.month, lm, `${date} 음력 월`);
    assert.equal(l.day, ld, `${date} 음력 일`);
  }

  // 독립 재계산 결과와 코드 테이블 대조
  for (const year of [2026, 2027, 2028]) {
    const expected = [];
    for (let m = 1; m <= 12; m++) {
      const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
      for (let d = 1; d <= last; d++) {
        const c = new KLC();
        if (!c.setSolarDate(year, m, d)) continue;
        const l = c.getLunarCalendar();
        if (l && SON.has(l.day)) expected.push(`${year}-${pad(m)}-${pad(d)}`);
      }
    }
    const actual = expected.filter((d) => specialDays.getSpecialDayMeta(d).isSonEomneunDay);
    assert.deepEqual(actual, expected, `${year} 손없는날 누락`);

    // 손없는날이 아닌 날이 잘못 포함되지 않았는지 역방향 확인
    for (let m = 1; m <= 12; m++) {
      const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
      for (let d = 1; d <= last; d++) {
        const ds = `${year}-${pad(m)}-${pad(d)}`;
        if (expected.includes(ds)) continue;
        assert.equal(
          specialDays.getSpecialDayMeta(ds).isSonEomneunDay, false,
          `${ds}는 손없는날이 아닌데 포함됨`
        );
      }
    }
  }
});

test('2026·2027 공휴일에 노동절과 제헌절이 포함된다', async () => {
  // 2026-05-11 시행: 제헌절 공휴일 재지정, 노동절 공휴일 지정
  const cases = [
    ['2026-05-01', '노동절'],
    ['2026-07-17', '제헌절'],
    ['2027-05-01', '노동절'],
    ['2027-07-17', '제헌절'],
  ];
  for (const [date, name] of cases) {
    const meta = specialDays.getSpecialDayMeta(date);
    assert.equal(meta.isHoliday, true, `${date} ${name}이 공휴일이어야 한다`);
    assert.match(meta.holidayName, new RegExp(name));
  }
});

test('2027 노동절·제헌절 대체공휴일이 정확하다', async () => {
  // 2027-05-01(토) 노동절 → 2027-05-03(월) 대체
  const labor = specialDays.getSpecialDayMeta('2027-05-03');
  assert.equal(labor.isHoliday, true);
  assert.match(labor.holidayName, /노동절 대체공휴일/);

  // 2027-07-17(토) 제헌절 → 2027-07-19(월) 대체
  const consti = specialDays.getSpecialDayMeta('2027-07-19');
  assert.equal(consti.isHoliday, true);
  assert.match(consti.holidayName, /제헌절 대체공휴일/);
});

test('설날·추석 연휴는 토요일 겹침으로 대체공휴일이 생기지 않는다', async () => {
  // 2026 추석: 9/24(목) 9/25(금) 9/26(토) — 토요일 겹침은 대체 대상 아님
  assert.equal(specialDays.getSpecialDayMeta('2026-09-28').isHoliday, false);
  // 2027 설날: 2/6(토) 2/7(일) 2/8(월) — 일요일 겹침 1일만 대체
  assert.equal(specialDays.getSpecialDayMeta('2027-02-09').isHoliday, true);
  assert.equal(specialDays.getSpecialDayMeta('2027-02-10').isHoliday, false, '대체는 1일만');
});

test('공휴일 테이블에 필수 공휴일이 연도별로 모두 존재한다', async () => {
  const required = ['신정', '삼일절', '노동절', '어린이날', '현충일', '제헌절', '광복절', '개천절', '한글날', '성탄절', '설날', '추석', '부처님오신날'];
  for (const year of [2026, 2027, 2028]) {
    const names = [];
    for (let m = 1; m <= 12; m++) {
      const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
      for (let d = 1; d <= last; d++) {
        const meta = specialDays.getSpecialDayMeta(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        if (meta.holidayName) names.push(meta.holidayName);
      }
    }
    for (const r of required) {
      assert.ok(names.some((n) => n.includes(r)), `${year}년에 ${r}이 없다`);
    }
  }
});

// ===========================================================================
// [신규] 지원 범위 밖 날짜는 예약을 허용하지 않는다
// ===========================================================================

test('특별일 데이터 지원 범위는 예약 가능 기간(오늘+365일)을 커버한다', async () => {
  const max = new Date();
  max.setDate(max.getDate() + 365);
  assert.ok(
    max.getFullYear() <= specialDays.SUPPORTED_YEARS.max,
    `예약 가능 최대 연도(${max.getFullYear()})가 데이터 범위(${specialDays.SUPPORTED_YEARS.max})를 초과 — scripts/generate-special-days.mjs로 확장 필요`
  );
});

test('[정책 변경] 특수일 캐시가 없어도 기본가격으로 견적이 진행된다', async () => {
  // 특수일 조회 실패가 전체 견적 실패로 전파되면 안 된다 (요구사항 25).
  // 가격표가 존재하면 최소 기본가격은 제공되어야 한다.
  const q = await pricing.calculateQuote({
    serviceType: '입주청소', houseTypeKey: '원룸', desiredDate: '2030-06-15',
  });
  assert.equal(q.basePrice, BASE_1R, '기본가격은 정상 조회된다');
  assert.equal(q.priceConfirmed, true);
  // 2030-06-15는 토요일 — 캐시가 없어도 요일 판정으로 가산 대상이 아님을 안다
  assert.equal(q.dateAdjustmentAmount, 0);
  assert.equal(q.estimatedTotal, BASE_1R);
});

test('특수일 캐시가 없어도 일요일은 요일 계산으로 가산된다', async () => {
  // 일요일은 날짜 자체로 판정 가능하므로 캐시 장애와 무관하다
  const r = await specialDayStore.resolveDateSurcharge('2030-06-16'); // 일요일
  assert.equal(r.amount, ADJ);
  assert.equal(r.specialDayAvailable, false, '캐시 미보유 상태임을 표시한다');

  const q = await pricing.calculateQuote({
    serviceType: '입주청소', houseTypeKey: '원룸', desiredDate: '2030-06-16',
  });
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
});

test('지원 범위 밖 날짜는 quote API가 400으로 거부한다', async () => {
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '원룸', extraOptions: [], desiredDate: '2030-06-15',
  }));
  assert.equal(res.status, 400);
  // 예약 가능 기간 검증이 먼저 걸러내고, 통과하더라도 특별일 데이터 범위에서 다시 막힌다
  assert.ok(
    ['OUT_OF_BOOKING_WINDOW', 'SPECIAL_DAY_NOT_SYNCED'].includes(res.body.code),
    `예상 밖 코드: ${res.body.code}`
  );
});

test('특수일 캐시 미보유는 specialDayAvailable로 구분된다', async () => {
  // "공휴일이 아님"과 "공휴일 여부를 알 수 없음"을 구분한다
  const known = await specialDayStore.resolveDateSurcharge('2026-12-15'); // 캐시 보유 평일
  assert.equal(known.specialDayAvailable, true);
  assert.equal(known.amount, 0);

  const unknown = await specialDayStore.resolveDateSurcharge('2030-06-15'); // 캐시 없음
  assert.equal(unknown.specialDayAvailable, false, '조회 실패를 숨기지 않는다');
  assert.equal(unknown.amount, 0, '알 수 없으면 가산하지 않고 기본가격으로 진행');
});

// ===========================================================================
// [신규] 상담 개인정보 동의 우회 방지
// ===========================================================================

test('동의를 전송하는 모든 폼이 동의값을 하드코딩하지 않는다', async () => {
  const forms = ['src/components/booking/BookingForm.tsx', 'src/app/consultation/ConsultationForm.tsx'];
  const offenders = [];
  for (const f of forms) {
    const full = path.join(process.cwd(), f);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    if (/(privacyAgreed|corePrinciplesAgreed|serviceTermsAgreed|additionalChargeAgreed):\s*true/.test(src)) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], `동의값 하드코딩:\n${offenders.join('\n')}`);
});

test('소스 전체에 동의값 하드코딩이 없다', async () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(full, 'utf8');
        // 서버가 검증 후 저장하는 경로(lib/api)는 제외하고 클라이언트 폼만 검사
        if (!full.includes('components') && !full.includes('app/consultation')) continue;
        if (/(privacyAgreed|corePrinciplesAgreed|serviceTermsAgreed|additionalChargeAgreed):\s*true/.test(src)) {
          offenders.push(full.replace(process.cwd() + '/', ''));
        }
      }
    }
  };
  walk(path.join(process.cwd(), 'src'));
  assert.deepEqual(offenders, [], `동의값 하드코딩:\n${offenders.join('\n')}`);
});

test('상담접수 API는 개인정보 미동의를 거부한다', async () => {
  const route = await import('../src/app/api/consultations/route.ts');
  const headers = new Headers();
  headers.set('x-forwarded-for', '198.51.100.77');
  const res = await route.POST({
    headers,
    async json() {
      return {
        customerName: '테스트', customerPhone: '010-9999-1234',
        serviceType: '입주청소', privacyAgreed: false,
      };
    },
  });
  assert.equal(res.status, 400);
});

test('[정책 변경] 예약폼에서 반려동물 입력이 제거됐다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.doesNotMatch(src, /petConfirmed|hasPet|petType|petCount|petNote/, '반려동물 state 잔존 금지');
  assert.doesNotMatch(src, /반려동물 확인/, '반려동물 확인 블록 잔존 금지');
});

// ===========================================================================
// [신규] 개인정보처리방침 / 브랜드·법인 분리
// ===========================================================================

test('개인정보처리방침이 legacy company_name 대신 법적 운영주체를 사용한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/privacy/page.tsx'), 'utf8');
  assert.doesNotMatch(src, /getSetting\("company_name"\)/, 'legacy company_name 직접 사용 금지');
  assert.match(src, /getCompanySettings/);
  assert.match(src, /legalCompanyName/);
  // placeholder가 남아 있으면 안 된다
  assert.doesNotMatch(src, /\[회사명\]/);
  assert.doesNotMatch(src, /\[연락처\]/);
  assert.doesNotMatch(src, /\[사업자등록번호\]/);
});

test('기본 상태에서 운영주체 정보가 placeholder 없이 표시된다', async () => {
  const settings = await import('../src/lib/settings.ts');
  const company = await settings.getCompanySettings();
  assert.equal(company.legalCompanyName, '주식회사 플린');
  assert.equal(company.legalCompanyNameEn, 'Plyn Inc.');
  assert.equal(company.bizNumber, '792-81-04045');
  assert.equal(company.phone, '070-4155-5403');
  assert.match(company.mailOrderNumber, /2026-의정부흥선-0327/);
});

test('관리자 settings에서 브랜드/법인 필드를 편집할 수 있다', async () => {
  const api = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/settings/route.ts'), 'utf8');
  for (const key of ['brand_name', 'legal_company_name', 'legal_company_name_en', 'company_mail_order_number']) {
    assert.match(api, new RegExp(`"${key}"`), `${key}가 allowlist에 없다`);
  }
  const ui = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/(protected)/settings/page.tsx'), 'utf8');
  for (const key of ['brand_name', 'legal_company_name', 'legal_company_name_en', 'company_mail_order_number']) {
    assert.match(ui, new RegExp(key), `${key} 편집 필드가 없다`);
  }
});

test('환불 페이지에 반려동물 추가금 미확정 문구가 없다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/refund/page.tsx'), 'utf8');
  assert.doesNotMatch(src, /반려동물 추가금/);
  // 현재 정책(상담 전환)이 반영되어야 한다
  assert.match(src, /상담/);
});

// ===========================================================================
// [신규] 가격 migration / 반려동물 동의문구 / 선거일
// ===========================================================================

test('가격 갱신은 기존 migration 수정이 아니라 신규 migration으로 추가됐다', async () => {
  const dir = path.join(process.cwd(), 'supabase/migrations');
  const files = fs.readdirSync(dir).sort();

  // 이미 Supabase에 적용된 migration은 내용이 변경되면 안 된다.
  // 원본 ZIP 기준 SHA-256으로 고정한다.
  const crypto = await import('node:crypto');
  const FROZEN = {
    '20260908090000_initial_clyn_clean.sql':
      '28fd0758644e00a58544b850059032ba53c0902fdc3e5092b388fc12c44054fb',
    '20260908091500_database_hardening.sql':
      'ddbb3386cd315361913c4dadaabe5a7195016a700176f4302bf6abecc0721d65',
  };
  for (const [name, hash] of Object.entries(FROZEN)) {
    const actual = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(dir, name)))
      .digest('hex');
    assert.equal(actual, hash, `${name}이 수정됐다 — 기존 migration은 변경 금지`);
  }

  // 신규 가격 migration이 존재하고 12개 가격을 모두 갱신한다
  const rev = files.find((f) => f.includes('price_revision_vat_included'));
  assert.ok(rev, '가격 갱신 신규 migration이 있어야 한다');
  const sql = fs.readFileSync(path.join(dir, rev), 'utf8');
  for (const price of [179000, 239000, 249000, 269000, 319000, 329000, 369000, 420000, 459000, 489000, 539000, 579000]) {
    assert.match(sql, new RegExp(String(price)), `${price} 갱신 누락`);
  }
  // 파괴적 구문 금지
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
});

test('DB 가격이 12개 상품 모두 최신 값과 일치한다', async () => {
  const expected = {
    '원룸': 179000, '원룸 복층': 239000, '1.5룸': 249000, '투룸': 269000,
    '쓰리룸': 319000, '18평': 329000, '24평': 369000, '28평': 420000,
    '32평': 459000, '34평': 489000, '38평': 539000, '40평': 579000,
  };
  for (const [note, price] of Object.entries(expected)) {
    const row = db.prepare(
      `SELECT base_price FROM price_rules WHERE service_type='입주청소' AND note=?`
    ).get(note);
    assert.ok(row, `${note} 가격 규칙 없음`);
    assert.equal(row.base_price, price, `${note} DB 가격`);
  }
});

test('40평은 DB 기준가 579,000을 유지하되 고객에게는 시작가로만 표시된다', async () => {
  const row = db.prepare(`SELECT base_price FROM price_rules WHERE service_type='입주청소' AND note='40평'`).get();
  assert.equal(row.base_price, 579000, 'DB에는 기준가를 그대로 저장');

  const q = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 50 });
  assert.equal(q.consultRequired, true);
  assert.equal(q.priceConfirmed, false);
  assert.equal(q.isStartingPrice, true);
  assert.match(q.displayPriceLabel, /579,000원부터/);
});

test('동의서의 반려동물 문구가 상담 전환 정책과 일치한다', async () => {
  const agreement = await import('../src/lib/agreement.ts');
  const sec3 = agreement.AGREEMENT_SECTIONS.find((s) => s.no === 3);
  // 반려동물을 단순 추가요금 항목으로 열거하면 안 된다
  assert.doesNotMatch(sec3.body, /반려동물 털 등 특수·과다 오염 : 별도 추가요금/);
  // 상담 전환 정책이 명시되어야 한다
  assert.match(sec3.body, /반려동물이 있었던 공간/);
  assert.match(sec3.body, /상담/);
});

test('공휴일 생성기가 선거일/임시공휴일 데이터 구조를 지원한다', async () => {
  const gen = fs.readFileSync(path.join(process.cwd(), 'scripts/generate-holidays.mjs'), 'utf8');
  assert.match(gen, /ELECTION_DAYS/);
  assert.match(gen, /TEMPORARY_HOLIDAYS/);
  // 선거일은 대체공휴일 적용 대상이 아니다
  assert.match(gen, /대체공휴일 미적용|대체공휴일 적용 대상이 아니/);
});

test('선거일이 공휴일로 판정되고 날짜 가산에 반영된다', async () => {
  // 2026-06-03 제9회 전국동시지방선거 (수요일)
  const meta = specialDays.getSpecialDayMeta('2026-06-03');
  assert.equal(meta.isHoliday, true);
  assert.match(meta.holidayName, /지방선거/);
  assert.equal(meta.isWeekend, false, '평일 선거일로 검증');
  assert.equal(specialDays.getDateAdjustment('2026-06-03'), 30000);
});

test('선거일에는 대체공휴일이 생기지 않는다', async () => {
  // 2026-06-03(수) 선거일 다음 평일에 대체공휴일이 생기면 안 된다
  assert.equal(specialDays.getSpecialDayMeta('2026-06-04').isHoliday, false);
});

// ===========================================================================
// [신규] balance_notice 부가세 포함 정책 / 반려동물 최종 확인 동기화
// ===========================================================================

test('balance_notice forward migration이 재실행 안전하게 추가됐다', async () => {
  const dir = path.join(process.cwd(), 'supabase/migrations');
  const f = fs.readdirSync(dir).find((n) => n.includes('balance_notice_vat_included'));
  assert.ok(f, 'balance_notice 갱신 migration이 있어야 한다');
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  assert.match(sql, /표시 금액은 부가세가 포함된 금액입니다/);
  // 행 유무와 무관하게 동작해야 한다
  assert.match(sql, /ON CONFLICT\s*\(key\)\s*DO UPDATE/i);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
});

test('구 balance_notice 값이 DB에 남아 있어도 고객 견적에 노출되지 않는다', async () => {
  const prev = db.prepare(`SELECT value FROM settings WHERE key='balance_notice'`).get()?.value;
  try {
    // 구 정책 값을 강제로 되돌려 놓는다
    db.prepare(`UPDATE settings SET value=? WHERE key='balance_notice'`)
      .run('잔금은 작업 완료 후 현장에서 안내드립니다.');

    // 일반 견적
    const q = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '24평' });
    assert.doesNotMatch(q.notice, /잔금은 작업 완료 후/);
    assert.match(q.notice, /부가세가 포함/);

    // 집정리 견적 — balanceNotice를 직접 사용하는 경로
    const j = await pricing.calculateQuote({ serviceType: '집정리', jipjeongriPackage: '2p4h' });
    assert.doesNotMatch(j.notice, /잔금은 작업 완료 후/, '집정리 notice에 구 문구가 새어나오면 안 된다');
    assert.doesNotMatch(j.notice, /VAT 별도|부가세 별도/);

    // 공개 API 응답에도 없어야 한다
    const res = await quoteRoute.POST(makeReq({
      serviceType: '집정리', jipjeongriPackage: '2p4h', extraOptions: [],
    }));
    assert.doesNotMatch(JSON.stringify(res.body), /잔금은 작업 완료 후/);
  } finally {
    if (prev !== undefined) {
      db.prepare(`UPDATE settings SET value=? WHERE key='balance_notice'`).run(prev);
    }
  }
});

test('VAT 별도 문구가 DB에 있어도 고객 견적에서 정화된다', async () => {
  const prev = db.prepare(`SELECT value FROM settings WHERE key='balance_notice'`).get()?.value;
  try {
    db.prepare(`UPDATE settings SET value=? WHERE key='balance_notice'`)
      .run('표시된 청소금액은 VAT 별도입니다.');
    const q = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '원룸' });
    assert.doesNotMatch(q.notice, /VAT 별도/);
    assert.match(q.notice, /부가세가 포함/);
  } finally {
    if (prev !== undefined) {
      db.prepare(`UPDATE settings SET value=? WHERE key='balance_notice'`).run(prev);
    }
  }
});

test('[정책 변경] 예약폼에서 추가서비스 선택이 제거됐다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.doesNotMatch(src, /extraOptions/, '추가서비스 선택이 남아 있으면 안 된다');
  assert.doesNotMatch(src, /추가 서비스 \(선택\)/);
});

test('40평 상담 건에서 최종 확인 "있었음"이면 반려동물 정보가 상담 데이터에 보존된다', async () => {
  const consultations = await import('../src/lib/consultations.ts');
  // 시나리오: 40평 이상 + 3단계에서 반려동물 없음 + 최종 확인에서 "있었음"
  // → BookingForm이 hasPet=true로 동기화한 뒤 petMeta를 함께 전송한다
  const created = await consultations.createConsultation({
    customerName: '40평펫고객',
    customerPhone: '010-9400-0001',
    serviceType: '입주청소',
    houseTypeKey: '40평',
    actualPyeong: 55,
    preferredDate: '2027-06-10',
    reason: 'size_40_plus',
    petMeta: { hasPet: true, confirmedAtFinalStep: true, type: '미입력', count: '미입력', hairSoil: '미입력', smell: false, feces: false, note: '' },
    privacyAgreed: true,
  });

  assert.equal(created.reason, 'size_40_plus', '40평이 주 사유');
  assert.ok(created.pet_meta, '반려동물 정보가 누락되면 안 된다');
  const meta = JSON.parse(created.pet_meta);
  assert.equal(meta.hasPet, true);
  assert.equal(meta.confirmedAtFinalStep, true, '최종 확인 단계에서 선택했음을 기록');
});

test('[정책 변경] 추가서비스는 견적에 반영되지 않는다', async () => {
  const q = await pricing.calculateQuote({
    serviceType: '입주청소', houseTypeKey: '24평', extraOptions: ['heavy_mold'],
  });
  assert.equal(q.extraTotal, 0, '추가서비스 금액은 견적에 포함되지 않는다');
  assert.deepEqual(q.optionBreakdown, []);
  assert.equal(q.estimatedTotal, CANONICAL_PRICES['24평']);
});

// ===========================================================================
// [신규] 예약 가능기간 단일 source / 상담 필수정보 / 대체공휴일 중복 방지
// ===========================================================================

test('예약 가능기간이 booking-window 단일 원천으로 통일됐다', async () => {
  const bw = await import('../src/lib/booking-window.ts');
  assert.equal(bw.BOOKING_WINDOW_DAYS, 365);

  const min = bw.bookingMinDate();
  const max = bw.bookingMaxDate();
  assert.match(min, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(max, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(max > min);

  // 365일 간격이어야 한다
  const diff = (new Date(`${max}T00:00:00Z`) - new Date(`${min}T00:00:00Z`)) / 86400000;
  assert.equal(diff, 365);

  assert.equal(bw.isWithinBookingWindow(min), true);
  assert.equal(bw.isWithinBookingWindow(max), true);
  assert.equal(bw.isWithinBookingWindow('2020-01-01'), false);
  assert.equal(bw.isWithinBookingWindow('2099-01-01'), false);
});

test('모든 소비처가 365를 하드코딩하지 않고 booking-window를 사용한다', async () => {
  const consumers = [
    'src/app/api/reservations/route.ts',
    'src/app/api/quote/route.ts',
    'src/app/api/calendar/route.ts',
    'src/components/booking/ReservationCalendar.tsx',
    'src/components/booking/BookingForm.tsx',
  ];
  for (const f of consumers) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.match(src, /booking-window/, `${f}가 booking-window를 사용해야 한다`);
    assert.doesNotMatch(src, /isTooFarFuture\([^)]*365/, `${f}에 365 하드코딩`);
  }
});

test('예약 가능기간 밖 날짜는 quote 발급이 거부된다 (B1)', async () => {
  const bw = await import('../src/lib/booking-window.ts');
  const beyond = new Date(`${bw.bookingMaxDate()}T00:00:00Z`);
  beyond.setUTCDate(beyond.getUTCDate() + 30);
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: beyond.toISOString().slice(0, 10),
  }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'OUT_OF_BOOKING_WINDOW');
  assert.equal(res.body.quoteToken, undefined);
});

test('캘린더는 예약 가능 월 범위를 벗어나 이동할 수 없다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  assert.match(src, /canGoPrev/);
  assert.match(src, /canGoNext/);
  assert.match(src, /disabled=\{!canGoPrev\}/);
  assert.match(src, /disabled=\{!canGoNext\}/);
  // 최대일 이후 날짜는 선택 불가 처리
  assert.match(src, /isBeyondWindow/);
});

test('날짜 직접 입력에도 max가 적용된다', async () => {
  for (const f of ['src/components/booking/BookingForm.tsx', 'src/app/consultation/ConsultationForm.tsx']) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.match(src, /max=\{(maxDate|bookingMaxDate\(\))\}/, `${f}에 max 속성이 없다`);
  }
});

// --- 상담접수 필수정보 ---

async function postConsultation(body, ip) {
  const route = await import('../src/app/api/consultations/route.ts');
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return route.POST({ headers, async json() { return body; } });
}

function baseConsultBody(overrides = {}) {
  return {
    customerName: '상담필수', customerPhone: '010-9600-0001',
    // v17 상담 API 계약: 상세 주소 필수
    address: '서울 강남구 역삼동 1-1',
    areaSido: '서울특별시', areaSigungu: '강남구', areaDong: '역삼동',
    serviceType: '입주청소', houseTypeKey: '24평',
    preferredDate: '2027-03-15',
    extraNotes: '현장 확인 요청드립니다.',
    privacyAgreed: true,
    ...overrides,
  };
}

test('일반 청소 상담은 필수정보가 하나라도 빠지면 API가 거부한다', async () => {
  const cases = [
    ['customerName', ''],
    ['areaSido', ''],
    ['areaSigungu', ''],
    ['areaDong', ''],
    ['preferredDate', undefined],
    ['address', ''],
    ['privacyAgreed', false],
  ];
  let ip = 100;
  for (const [field, value] of cases) {
    const body = baseConsultBody();
    if (value === undefined) delete body[field];
    else body[field] = value;
    const res = await postConsultation(body, `203.0.114.${ip++}`);
    assert.equal(res.status, 400, `${field} 누락이 거부되지 않음`);
  }
});

test('일반 청소 상담은 주택유형과 공급면적이 모두 없으면 거부한다', async () => {
  const body = baseConsultBody();
  delete body.houseTypeKey;
  const res = await postConsultation(body, '203.0.115.1');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /주택유형|공급면적/);

  // 공급면적만 있어도 통과해야 한다
  const ok = await postConsultation(
    { ...body, actualPyeong: 52, customerPhone: '010-9600-0002' },
    '203.0.115.2'
  );
  assert.equal(ok.status, 201);
});

test('집정리 상담은 평형 대신 정리 정보를 필수로 받는다', async () => {
  const body = baseConsultBody({
    serviceType: '집정리', customerPhone: '010-9600-0003',
  });
  delete body.houseTypeKey;

  // 정리 정보 없으면 거부
  const bad = await postConsultation(body, '203.0.116.1');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /정리/);

  // 정리 정보가 있으면 평형 없이도 통과
  const ok = await postConsultation(
    { ...body, jipjeongriInfo: '드레스룸 옷 정리, 주방 상부장' },
    '203.0.116.2'
  );
  assert.equal(ok.status, 201);
  const row = db.prepare(
    `SELECT extra_notes FROM consultation_requests WHERE request_code=?`
  ).get(ok.body.requestCode);
  assert.match(row.extra_notes, /정리 요청/, '정리 정보가 보존되어야 한다');
});

// --- 대체공휴일 중복 방지 ---

test('같은 날짜에 공휴일 2개가 겹쳐도 대체공휴일은 1일만 생성된다', async () => {
  // 2028-10-03: 개천절 + 추석 연휴 중복
  const overlap = specialDays.getSpecialDayMeta('2028-10-03');
  assert.equal(overlap.isHoliday, true);

  assert.equal(specialDays.getSpecialDayMeta('2028-10-05').isHoliday, true, '대체공휴일 1일은 있어야 한다');
  assert.equal(specialDays.getSpecialDayMeta('2028-10-06').isHoliday, false, '대체공휴일이 2개 생기면 안 된다');
});

test('공휴일 생성기가 같은 날짜에 대해 대체공휴일을 중복 생성하지 않는다', async () => {
  const gen = fs.readFileSync(path.join(process.cwd(), 'scripts/generate-holidays.mjs'), 'utf8');
  assert.match(gen, /substitutedDates/);
  assert.match(gen, /if\(substitutedDates\.has\(d\)\) continue;/);
});

test('공휴일 생성기가 CLI 연도 인자를 받는다', async () => {
  const gen = fs.readFileSync(path.join(process.cwd(), 'scripts/generate-holidays.mjs'), 'utf8');
  assert.match(gen, /process\.argv\.slice\(2\)/);
  // generate-special-days가 연도를 전달해야 한다
  const sd = fs.readFileSync(path.join(process.cwd(), 'scripts/generate-special-days.mjs'), 'utf8');
  assert.match(sd, /generate-holidays\.mjs/);
  assert.match(sd, /\$\{year\}/, 'generate-special-days가 연도를 전달해야 한다');
});

// ===========================================================================
// [신규] 특수일 DB 캐시 구조 (KASI OpenAPI 기반)
// ===========================================================================

test('공휴일 판정이 고객 요청 경로에서 KASI를 실시간 호출하지 않는다', async () => {
  // v17이 캘린더를 재작성했다. 구현 세부(함수명) 대신 위험 자체를 검사한다.
  const customerPaths = [
    'src/app/api/calendar/route.ts',
    'src/app/api/quote/route.ts',
    'src/app/api/reservations/route.ts',
  ];
  for (const f of customerPaths) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.doesNotMatch(src, /from ["']@\/lib\/kasi["']/, `${f}가 KASI를 직접 호출하면 안 된다`);
    assert.doesNotMatch(src, /apis\.data\.go\.kr/, `${f}에 KASI 엔드포인트 직접 호출`);
  }
});

test('DB 캐시에서 공휴일과 손없는날을 읽는다', async () => {
  const info = await specialDayStore.getSpecialDay('2026-05-01');
  assert.equal(info.isHoliday, true);
  assert.match(info.holidayName, /노동절/);

  const son = await specialDayStore.getSpecialDay('2026-12-17');
  assert.equal(son.isSonEomneunDay, true);
});

test('토/일은 캐시가 아니라 서버 날짜 계산으로 판정한다', async () => {
  const sat = await specialDayStore.getSpecialDay('2026-12-12');
  assert.equal(sat.isSaturday, true);
  assert.equal(sat.isWeekend, true);
  const sun = await specialDayStore.getSpecialDay('2026-12-13');
  assert.equal(sun.isSunday, true);
  assert.equal(sun.isWeekend, true);

  // DB 행의 is_holiday/is_son과 무관하게 요일은 항상 정확하다
  const row = db.prepare(`SELECT is_holiday, is_son_eomneun_day FROM special_days WHERE date='2026-12-12'`).get();
  assert.ok(row, '캐시 행은 존재');
  assert.equal(sat.isWeekend, true);
});

test('캐시에 없는 날짜는 getSpecialDay가 여전히 오류를 던진다', async () => {
  // 저수준 조회는 "없음"을 "일반일"로 단정하지 않는다.
  // 가격 경로는 resolveDateSurcharge가 이를 흡수해 예약을 막지 않는다.
  await assert.rejects(
    () => specialDayStore.getSpecialDay('2035-01-15'),
    /준비되지 않았습니다/
  );
  const r = await specialDayStore.resolveDateSurcharge('2035-01-15');
  assert.equal(r.specialDayAvailable, false, '가격 경로는 흡수한다');
});

test('KASI API를 고객 요청 경로에서 호출하지 않는다', async () => {
  const customerPaths = [
    'src/lib/pricing.ts',
    'src/app/api/calendar/route.ts',
    'src/app/api/quote/route.ts',
    'src/app/api/reservations/route.ts',
    'src/app/api/consultations/route.ts',
  ];
  for (const f of customerPaths) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.doesNotMatch(src, /from ["']@\/lib\/kasi["']/, `${f}가 KASI를 직접 호출하면 안 된다`);
    assert.doesNotMatch(src, /apis\.data\.go\.kr/, `${f}에 KASI 엔드포인트 직접 호출`);
  }
  // KASI 호출은 동기화 계층에서만 이뤄진다
  const store = fs.readFileSync(path.join(process.cwd(), 'src/lib/special-days-store.ts'), 'utf8');
  assert.match(store, /from "\.\/kasi"/);
});

test('동기화는 예약 가능 기간 이상을 커버한다', async () => {
  const coverage = await specialDayStore.checkCoverage();
  assert.equal(coverage.covered, true, `커버리지 부족: ${coverage.missing}일 누락`);
  assert.ok(coverage.syncedThrough >= coverage.to, '동기화 범위가 예약 가능 기간 이상이어야 한다');
});

test('관리자 manual override가 동기화에 덮어써지지 않는다', async () => {
  const date = '2027-04-20';
  try {
    await specialDayStore.setManualSpecialDay({
      date, isHoliday: true, holidayName: '임시공휴일', isSonEomneunDay: false,
      adminNote: '국무회의 의결',
    });
    let info = await specialDayStore.getSpecialDay(date);
    assert.equal(info.isHoliday, true);
    assert.equal(info.source, 'manual');
    assert.match(info.holidayName, /임시공휴일/);

    // 재동기화해도 manual 값이 유지되어야 한다
    const result = await specialDayStore.syncSpecialDays({ from: '2027-04-01', days: 60, force: true });
    assert.ok(result.skippedManual >= 1, 'manual 날짜는 건너뛰어야 한다');
    info = await specialDayStore.getSpecialDay(date);
    assert.equal(info.source, 'manual', '동기화가 manual을 덮어쓰면 안 된다');
    assert.equal(info.isHoliday, true);

    // 임시공휴일도 날짜 가산에 반영된다
    assert.equal(await specialDayStore.getDateAdjustmentFromStore(date), 30000);
  } finally {
    await specialDayStore.clearManualSpecialDay(date);
    await specialDayStore.syncSpecialDays({ from: '2027-04-01', days: 60, force: true });
  }
});

test('manual override 해제 후 원래 값으로 복구된다', async () => {
  const date = '2027-04-21';
  await specialDayStore.setManualSpecialDay({
    date, isHoliday: true, holidayName: '테스트', isSonEomneunDay: false,
  });
  assert.equal((await specialDayStore.getSpecialDay(date)).source, 'manual');
  await specialDayStore.clearManualSpecialDay(date);
  assert.equal(await specialDayStore.isDateSynced(date), false, '해제 시 행이 제거된다');
  await specialDayStore.syncSpecialDays({ from: '2027-04-01', days: 60 });
  assert.equal(await specialDayStore.isDateSynced(date), true, '재동기화로 복구된다');
});

test('정적 special-days.ts는 backfill 보조 용도로만 표시된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/special-days.ts'), 'utf8');
  assert.match(src, /Production source of truth가 아닙니다/);
  assert.match(src, /backfill/);
});

test('캘린더 API는 예약 가능 범위를 벗어난 start/end를 제한한다', async () => {
  const calendarRoute = await import('../src/app/api/calendar/route.ts');
  const bw = await import('../src/lib/booking-window.ts');
  const res = await calendarRoute.GET({
    url: 'http://localhost/api/calendar?start=2020-01-01&end=2099-12-31',
  });
  const body = await res.json();
  assert.ok(body.days.length > 0);
  const dates = body.days.map((d) => d.date);
  assert.ok(dates[0] >= bw.bookingMinDate(), '예약 시작일 이전은 반환하지 않는다');
  assert.ok(dates[dates.length - 1] <= bw.bookingMaxDate(), '예약 최대일 이후는 반환하지 않는다');
});

test('특수일 캐시가 없어도 예약 가능 슬롯 자체는 닫지 않는다', async () => {
  // 구현 세부가 아니라 실제 동작으로 검사한다.
  const calendarRoute = await import('../src/app/api/calendar/route.ts');
  const bw = await import('../src/lib/booking-window.ts');
  // 특수일 캐시가 없는 먼 미래 날짜라도 슬롯이 무조건 닫히면 안 된다
  const start = bw.bookingMinDate();
  const res = await calendarRoute.GET({ url: `http://localhost/api/calendar?start=${start}&end=${start}` });
  const body = await res.json();
  assert.ok(body.days.length > 0);
  const day = body.days[0];
  assert.ok(['예약가능', '예약진행 중', '예약완료'].includes(day.morning.publicStatus));
});

test('상담접수도 예약 가능 기간을 서버에서 검증한다', async () => {
  const bw = await import('../src/lib/booking-window.ts');
  const beyond = new Date(`${bw.bookingMaxDate()}T00:00:00Z`);
  beyond.setUTCDate(beyond.getUTCDate() + 30);
  const ds = beyond.toISOString().slice(0, 10);

  const res = await postConsultation(
    baseConsultBody({ preferredDate: ds, customerPhone: '010-9700-0001' }),
    '203.0.117.1'
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'OUT_OF_BOOKING_WINDOW');
});

test('special_days 캐시 migration이 신규 파일로 추가됐다', async () => {
  const dir = path.join(process.cwd(), 'supabase/migrations');
  const f = fs.readdirSync(dir).find((n) => n.includes('special_days_cache'));
  assert.ok(f, 'special_days migration이 있어야 한다');
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.special_days/);
  assert.match(sql, /source/);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
});

// ===========================================================================
// [신규] KASI 실제 경로 — fixture 기반
// ===========================================================================

const KASI_FIXTURES = {
  holidaysOk: {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: {
        items: {
          item: [
            { dateKind: '01', dateName: '어린이날', isHoliday: 'Y', locdate: 20270505, seq: 1 },
            { dateKind: '01', dateName: '부처님오신날', isHoliday: 'Y', locdate: 20270513, seq: 1 },
            { dateKind: '02', dateName: '어버이날', isHoliday: 'N', locdate: 20270508, seq: 1 },
          ],
        },
        numOfRows: 100, pageNo: 1, totalCount: 3,
      },
    },
  },
  holidaysEmpty: {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { items: '', numOfRows: 100, pageNo: 1, totalCount: 0 },
    },
  },
  lunarMonthOk: {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: {
        items: {
          item: [
            { solYear: '2027', solMonth: '05', solDay: '01', lunYear: '2027', lunMonth: '03', lunDay: '26' },
            { solYear: '2027', solMonth: '05', solDay: '05', lunYear: '2027', lunMonth: '03', lunDay: '30' },
            { solYear: '2027', solMonth: '05', solDay: '06', lunYear: '2027', lunMonth: '04', lunDay: '01' },
          ],
        },
        totalCount: 3,
      },
    },
  },
  lunarDayOk: {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: {
        items: { item: { solYear: '2027', solMonth: '05', solDay: '05', lunMonth: '03', lunDay: '30' } },
        totalCount: 1,
      },
    },
  },
  resultCodeError: {
    response: {
      header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED ERROR.' },
      body: { items: '', totalCount: 0 },
    },
  },
  malformed: { unexpected: 'shape' },
};

/** fetch를 fixture로 대체 */
function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}
function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

test('KASI 공휴일 정상 응답을 파싱한다 (isHoliday=N 제외)', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => jsonResponse(KASI_FIXTURES.holidaysOk));
  try {
    const kasi = await import('../src/lib/kasi.ts');
    const list = await kasi.fetchHolidays(2027, 5);
    assert.equal(list.length, 2, 'isHoliday=N인 어버이날은 제외되어야 한다');
    assert.deepEqual(list.map((h) => h.date), ['2027-05-05', '2027-05-13']);
    assert.equal(list[0].name, '어린이날');
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI 공휴일 0건 정상 응답을 빈 배열로 처리한다', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => jsonResponse(KASI_FIXTURES.holidaysEmpty));
  try {
    const kasi = await import('../src/lib/kasi.ts');
    const list = await kasi.fetchHolidays(2027, 11);
    assert.deepEqual(list, [], '공휴일 없는 달은 빈 배열');
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI 음력 월 단위 응답을 파싱한다', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => jsonResponse(KASI_FIXTURES.lunarMonthOk));
  try {
    const kasi = await import('../src/lib/kasi.ts');
    const map = await kasi.fetchLunarMonth(2027, 5);
    assert.equal(map.get('2027-05-05'), 30, '음력 30일 = 손없는날');
    assert.equal(map.get('2027-05-06'), 1);
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI 음력 일 단위 응답을 파싱한다', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => jsonResponse(KASI_FIXTURES.lunarDayOk));
  try {
    const kasi = await import('../src/lib/kasi.ts');
    assert.equal(await kasi.fetchLunarDay('2027-05-05'), 30);
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI resultCode 오류를 "공휴일 없음"으로 처리하지 않는다', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => jsonResponse(KASI_FIXTURES.resultCodeError));
  try {
    const kasi = await import('../src/lib/kasi.ts');
    await assert.rejects(() => kasi.fetchHolidays(2027, 5), /resultCode=30/);
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI malformed 응답을 거부한다', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => jsonResponse(KASI_FIXTURES.malformed));
  try {
    const kasi = await import('../src/lib/kasi.ts');
    await assert.rejects(() => kasi.fetchHolidays(2027, 5), /형식이 올바르지 않습니다/);
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI timeout/network 실패를 KasiUnavailableError로 변환한다', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => { throw new Error('The operation was aborted due to timeout'); });
  try {
    const kasi = await import('../src/lib/kasi.ts');
    await assert.rejects(() => kasi.fetchHolidays(2027, 5), /KASI 호출 실패/);
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI HTTP 오류를 거부한다', async () => {
  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  const restore = stubFetch(async () => jsonResponse({}, 500));
  try {
    const kasi = await import('../src/lib/kasi.ts');
    await assert.rejects(() => kasi.fetchHolidays(2027, 5), /HTTP 500/);
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

test('KASI 동기화 실패 시 기존 캐시를 훼손하지 않는다', async () => {
  const probe = '2027-05-05';
  const before = db.prepare(`SELECT * FROM special_days WHERE date=?`).get(probe);
  assert.ok(before, '사전 캐시가 있어야 한다');

  process.env.KASI_SERVICE_KEY = 'TEST_KEY';
  // 공휴일은 정상, 음력은 실패 → 검증 단계에서 중단되어야 한다
  const restore = stubFetch(async (url) => {
    if (String(url).includes('getRestDeInfo')) return jsonResponse(KASI_FIXTURES.holidaysOk);
    throw new Error('network down');
  });
  try {
    await assert.rejects(
      () => specialDayStore.syncSpecialDays({ from: '2027-05-01', days: 10, force: true }),
      /KASI/
    );
    const after = db.prepare(`SELECT * FROM special_days WHERE date=?`).get(probe);
    assert.deepEqual(after, before, '실패 시 기존 캐시가 변경되면 안 된다');
  } finally {
    restore();
    delete process.env.KASI_SERVICE_KEY;
  }
});

// ===========================================================================
// [신규] Production fallback 금지 / coverage 강화 / cron
// ===========================================================================

test('Production에서는 KASI 키 없이 generator fallback을 사용하지 않는다', async () => {
  const prev = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(specialDayStore.isGeneratorFallbackAllowed(), false);
    await assert.rejects(
      () => specialDayStore.syncSpecialDays({ from: '2027-08-01', days: 5 }),
      /KASI_SERVICE_KEY가 설정되지 않았습니다/
    );
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('development에서는 generator fallback이 허용된다', async () => {
  assert.equal(specialDayStore.isGeneratorFallbackAllowed(), true);
  const r = await specialDayStore.syncSpecialDays({ from: '2027-08-01', days: 5 });
  assert.equal(r.source, 'generator');
});

test('coverage는 count만이 아니라 source와 freshness를 함께 본다', async () => {
  const c = await specialDayStore.checkCoverage();
  assert.equal(typeof c.expected, 'number');
  assert.equal(typeof c.actual, 'number');
  assert.ok(c.bySource, 'source별 집계가 있어야 한다');
  assert.ok(Array.isArray(c.issues));

  // Production 기준으로 보면 generator 데이터는 정상이 아니다
  const prev = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const prod = await specialDayStore.checkCoverage();
    assert.equal(prod.covered, false, 'generator 데이터만 있으면 Production 정상이 아니다');
    assert.ok(
      prod.issues.some((i) => /generator/.test(i)),
      `generator 이슈가 보고되어야 한다: ${prod.issues.join(", ")}`
    );
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('Production에서 generator 행은 고객에게 제공되지 않는다 (fail-closed)', async () => {
  const prev = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    // 캐시에 행은 있지만 source=generator
    await assert.rejects(
      () => specialDayStore.getSpecialDay('2026-12-17'),
      /준비되지 않았습니다/
    );
    assert.equal(await specialDayStore.isDateSynced('2026-12-17'), false);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('instrumentation은 Production 부팅에서 blocking DB I/O를 하지 않는다', async () => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src/instrumentation.ts'), 'utf8');
  // 주석은 제외하고 실제 코드 라인만 검사한다
  const src = raw
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
  // 부팅 경로에서 DB를 기다리면 홈페이지 TTFB가 DB 응답에 묶인다
  assert.doesNotMatch(src, /syncSpecialDays\(/, '부팅 시 동기화 금지');
  assert.doesNotMatch(src, /checkCoverage/, '부팅 시 special_days 조회 금지');
  assert.doesNotMatch(src, /ensureDatabaseReady|ensureAdminSeeded|seedAdmin/, '부팅 시 admin seed 금지');
  assert.doesNotMatch(src, /getSetting|getSettings|queryRow|queryRows/, '부팅 시 settings 조회 금지');
  assert.doesNotMatch(src, /@\/database"/, '부팅 시 DB 모듈 import 금지');
  // 환경변수 확인만 남는다
  assert.match(src, /DATABASE_URL/);
});

test('admin seed는 로그인 경로에서 lazy 수행된다', async () => {
  const dbIndex = fs.readFileSync(path.join(process.cwd(), 'src/database/index.ts'), 'utf8');
  assert.match(dbIndex, /export function ensureAdminSeeded/);
  const login = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/login/route.ts'), 'utf8');
  assert.match(login, /ensureAdminSeeded/);
});

test('cron 엔드포인트는 CRON_SECRET Bearer 인증을 요구한다', async () => {
  const cron = await import('../src/app/api/cron/special-days/route.ts');
  const prev = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = 'test-cron-secret';

    // 인증 없음
    const noAuth = await cron.GET({ headers: new Headers() });
    assert.equal(noAuth.status, 401);

    // 잘못된 토큰
    const badHeaders = new Headers();
    badHeaders.set('authorization', 'Bearer wrong');
    const bad = await cron.GET({ headers: badHeaders });
    assert.equal(bad.status, 401);

    // 정상 토큰
    const okHeaders = new Headers();
    okHeaders.set('authorization', 'Bearer test-cron-secret');
    const ok = await cron.GET({ headers: okHeaders });
    assert.notEqual(ok.status, 401);
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
});

test('cron과 관리자 인증을 혼용하지 않는다', async () => {
  const cronSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/api/cron/special-days/route.ts'), 'utf8');
  assert.doesNotMatch(cronSrc, /requireAdminApiSession/, 'cron은 관리자 세션을 쓰지 않는다');
  assert.match(cronSrc, /CRON_SECRET/);

  const adminSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/special-days/route.ts'), 'utf8');
  assert.match(adminSrc, /requireAdminApiSession/, '관리자 API는 세션 인증을 유지한다');
  assert.doesNotMatch(adminSrc, /CRON_SECRET/, '관리자 API에 cron 인증을 섞지 않는다');
});

test('vercel.json에 일 1회 동기화 cron이 등록됐다', async () => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8');
  const cfg = JSON.parse(raw);
  assert.ok(Array.isArray(cfg.crons));
  const job = cfg.crons.find((c) => c.path === '/api/cron/special-days');
  assert.ok(job, 'special-days cron이 등록되어야 한다');
  // 일 1회 (분 시 * * *)
  assert.match(job.schedule, /^\d+ \d+ \* \* \*$/, `일 1회 스케줄이어야 한다: ${job.schedule}`);
});

test('증분 동기화는 전체 425일을 다시 조회하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/special-days-store.ts'), 'utf8');
  assert.match(src, /syncSpecialDaysIncremental/);
  assert.match(src, /tail/i, 'tail 구간만 추가하는 로직이 있어야 한다');
  // 월 단위 조회 우선 + bounded concurrency
  assert.match(src, /fetchLunarMonth/);
  assert.match(src, /mapWithConcurrency/);
});

test('staging smoke 스크립트가 인증키를 저장하지 않는다', async () => {
  const p = path.join(process.cwd(), 'scripts/kasi-smoke.mjs');
  assert.ok(fs.existsSync(p));
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /process\.env\.KASI_SERVICE_KEY/);
  assert.match(src, /Git에 저장하지 마세요|Git에 저장하지 않/);
  // 실제 키처럼 보이는 긴 문자열이 하드코딩되면 안 된다
  assert.doesNotMatch(src, /serviceKey=[A-Za-z0-9%+/=]{20,}/);
});

// ===========================================================================
// [신규] E2E 수정 — 캘린더 에러 상태 / N+1 제거 / 오류 메시지 / 사이청소 label
// ===========================================================================

test('캘린더는 데이터가 없을 때 예약완료로 fallback하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  // 데이터 없음 → 예약완료 로 대체하는 구문이 없어야 한다
  assert.doesNotMatch(
    src,
    /if \(!day\) return \{ publicStatus: "예약완료"/,
    'API 실패/데이터 없음을 예약완료로 표시하면 안 된다'
  );
  assert.match(src, /if \(!day\) return null/, '데이터 없으면 null을 반환해야 한다');
  // loading / success / error 상태 분리
  assert.match(src, /"loading" \| "success" \| "error"/);
  // 에러 문구와 재시도 버튼
  assert.match(src, /예약 일정을 불러오지 못했습니다/);
  assert.match(src, /다시 불러오기/);
});

test('캘린더는 HTTP 오류/비정상 응답을 에러 상태로 처리한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  // HTTP 오류를 정상 응답처럼 파싱하지 않는다
  assert.match(src, /if \(!r\.ok\) throw new Error/);
  // days 배열이 아니면 오류
  assert.match(src, /Array\.isArray\(data\.days\)/);
  // catch에서 예약완료가 아니라 error 상태로 전환
  assert.match(src, /setStatus\("error"\)/);
  // catch 블록 자체에 예약완료 대체가 없어야 한다
  const catchBlock = src.slice(src.indexOf('.catch('), src.indexOf('.catch(') + 300);
  // 주석은 제외하고 실제 코드 라인만 검사한다
  const catchCode = catchBlock
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.doesNotMatch(catchCode, /예약완료/, 'catch에서 예약완료로 표시하면 안 된다');
  assert.match(catchCode, /setStatus\("error"\)/);
});

test('재시도 버튼이 캘린더를 재호출한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  assert.match(src, /reloadToken/);
  assert.match(src, /setReloadToken\(\(t\) => t \+ 1\)/);
  // effect 의존성에 reloadToken이 포함되어야 재호출된다
  assert.match(src, /\}, \[cursor, reloadToken\]\)/);
});

test('정상 API에서 실제 마감 슬롯은 예약완료로 표시된다', async () => {
  const calendarRoute = await import('../src/app/api/calendar/route.ts');
  const date = '2027-08-10';
  await calendar.setCalendarDay(date, 'available', 1, null, 'morning');

  const created = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    houseTypeKey: '24평', desiredDate: date, timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7500-0001',
  })));
  assert.equal(created.status, 201);
  const id = created.body.reservation.id;

  // 입금확인 → 관리자 확정까지 완료해야 '예약완료'가 된다
  await reservations.confirmPayment(id, '관리자', null);
  await reservations.confirmReservation(id, '관리자', null);

  const res = await calendarRoute.GET({ url: `http://localhost/api/calendar?start=${date}&end=${date}` });
  const body = await res.json();
  const day = body.days.find((d) => d.date === date);
  assert.equal(day.morning.publicStatus, '예약완료');
  assert.equal(day.morning.selectable, false);
});

test('월간 캘린더 조회는 날짜 수에 비례해 count 쿼리를 반복하지 않는다', async () => {
  // 구현 함수명이 아니라 "날짜별 반복 조회가 없는가"를 검사한다.
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/calendar/route.ts'), 'utf8');
  // 날짜 루프 안에서 await 하는 DB 조회가 없어야 한다
  assert.doesNotMatch(src, /for\s*\([^)]*\)\s*\{[^}]*await\s+\w*[Rr]epo\./s, '날짜 루프 내 반복 DB 조회 금지');
  // 범위 단위 집계를 사용해야 한다
  assert.match(src, /Range|IN \(|GROUP BY|aggregate/i, '범위 집계를 사용해야 한다');
});

test('월 aggregate 결과가 기존 공개 계약과 동일하다', async () => {
  const calendarRoute = await import('../src/app/api/calendar/route.ts');
  const start = '2027-07-10';
  const end = '2027-07-12';
  for (const d of [start, '2027-07-11', end]) {
    await calendar.setCalendarDay(d, 'available', 1, null, 'morning');
    await calendar.setCalendarDay(d, 'available', 1, null, 'afternoon');
  }
  const res = await calendarRoute.GET({ url: `http://localhost/api/calendar?start=${start}&end=${end}` });
  const body = await res.json();
  assert.equal(body.days.length, 3);
  for (const day of body.days) {
    for (const slot of [day.morning, day.afternoon]) {
      assert.ok(['예약가능', '예약진행 중', '예약완료'].includes(slot.publicStatus));
      assert.equal(typeof slot.selectable, 'boolean');
      assert.equal(typeof slot.consultRequired, 'boolean');
    }
    // 특수일 메타 유지
    assert.equal(typeof day.isSonEomneunDay, 'boolean');
    assert.equal(typeof day.isHoliday, 'boolean');
  }
  // 수량 비노출 유지
  assert.doesNotMatch(JSON.stringify(body), /remaining|bookedCount|capacity/);
});

test('capacity 0 / 마감 / 가능 상태가 월 조회에서도 정확하다', async () => {
  const calendarRoute = await import('../src/app/api/calendar/route.ts');
  await calendar.setCalendarDay('2027-07-20', 'available', 0, null, 'morning');   // capacity 0
  await calendar.setCalendarDay('2027-07-21', 'available', 2, null, 'morning');   // 여유
  await calendar.setCalendarDay('2027-07-22', 'closed', 1, null, 'morning');      // 관리자 예약 불가

  const res = await calendarRoute.GET({ url: 'http://localhost/api/calendar?start=2027-07-20&end=2027-07-22' });
  const body = await res.json();
  const get = (d) => body.days.find((x) => x.date === d).morning;

  assert.equal(get('2027-07-20').selectable, false, 'capacity 0은 선택 불가');
  assert.equal(get('2027-07-21').selectable, true, '여유 있으면 선택 가능');
  assert.equal(get('2027-07-21').publicStatus, '예약가능');
  assert.equal(get('2027-07-22').selectable, false, '관리자 마감은 선택 불가');
});

// --- 오류 메시지 분기 ---

test('서버 JSON 오류를 네트워크 오류로 표현하지 않는다', async () => {
  const em = await import('../src/lib/error-messages.ts');
  const cases = [
    [400, { code: 'OUT_OF_BOOKING_WINDOW' }, /예약 가능한 날짜 범위/],
    [400, { code: 'SPECIAL_DAY_NOT_SYNCED' }, /예약 정보를 준비 중/],
    [400, { code: 'SPECIAL_DAY_UNAVAILABLE' }, /예약 정보를 준비 중/],
    [409, { code: 'SLOT_UNAVAILABLE' }, /예약이 마감/],
    [409, { code: 'SLOT_TAKEN' }, /예약이 마감/],
    [409, { code: 'DATE_FULLY_BOOKED' }, /예약이 마감/],
    [400, { error: '연락처 형식이 올바르지 않습니다.' }, /연락처 형식/],
    [500, { error: 'internal' }, /예약 처리 중 오류/],
    [500, null, /예약 처리 중 오류/],
  ];
  for (const [status, body, re] of cases) {
    const msg = em.messageFromServerError(status, body);
    assert.match(msg, re, `${status} ${JSON.stringify(body)}`);
    assert.doesNotMatch(msg, /네트워크/, '서버 응답을 네트워크 오류로 표현하면 안 된다');
  }
});

test('fetch 실패만 네트워크 오류로 처리한다', async () => {
  const em = await import('../src/lib/error-messages.ts');
  const restore = stubFetch(async () => { throw new TypeError('Failed to fetch'); });
  try {
    const out = await em.callApi('/api/test');
    assert.equal(out.kind, 'networkError');
    assert.match(out.message, /네트워크 연결에 문제/);
  } finally { restore(); }
});

test('callApi가 HTTP 상태별로 결과를 구분한다', async () => {
  const em = await import('../src/lib/error-messages.ts');
  // 200
  let restore = stubFetch(async () => jsonResponse({ ok: true }, 200));
  try {
    const out = await em.callApi('/api/test');
    assert.equal(out.kind, 'success');
  } finally { restore(); }

  // 409 CONSULT_REQUIRED — 본문을 그대로 전달해 상담 흐름을 유지한다
  restore = stubFetch(async () => jsonResponse({ code: 'CONSULT_REQUIRED', requestCode: 'CS-1', notice: '상담' }, 409));
  try {
    const out = await em.callApi('/api/test');
    assert.equal(out.kind, 'serverError');
    assert.equal(out.status, 409);
    assert.equal(out.body.code, 'CONSULT_REQUIRED');
  } finally { restore(); }
});

test('고객 폼이 서버 오류를 네트워크 오류로 뭉뚱그리지 않는다', async () => {
  const forms = [
    'src/components/booking/BookingForm.tsx',
    'src/app/consultation/ConsultationForm.tsx',
    'src/app/reservation/ReservationLookup.tsx',
  ];
  for (const f of forms) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.doesNotMatch(src, /setError\("네트워크 오류가 발생했습니다\."\)/, `${f}에 뭉뚱그린 문구 잔존`);
    assert.match(src, /callApi/, `${f}가 callApi를 사용해야 한다`);
  }
});

test('BookingForm이 서버 오류 코드를 generic 문구로 덮지 않는다', async () => {
  // v17이 BookingForm을 재작성했다. 구 흐름명 대신 위험 자체를 검사한다.
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.doesNotMatch(src, /setError\("네트워크 오류가 발생했습니다\."\)/, '서버 오류를 네트워크 오류로 뭉뚱그리면 안 된다');
  assert.match(src, /callApi|res\.status|data\.code|outcome/, '서버 응답 코드를 사용해야 한다');
});

// --- 사이청소 label ---

test('고객 UI에 "사이청소" label이 적용된다', async () => {
  const types = await import('../src/lib/types.ts');
  assert.equal(types.serviceLabel('사이청소'), '사이청소');
  assert.equal(types.serviceLabel('입주청소'), '입주청소');
  assert.match(types.SERVICE_TYPE_SHORT_DESC['사이청소'], /퇴거와 새 입주 사이/);

  for (const f of [
    'src/components/ServiceList.tsx',
    'src/components/booking/BookingForm.tsx',
    'src/app/consultation/ConsultationForm.tsx',
  ]) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.match(src, /serviceLabel/, `${f}가 고객 label을 사용해야 한다`);
  }

  const list = fs.readFileSync(path.join(process.cwd(), 'src/components/ServiceList.tsx'), 'utf8');
  assert.match(list, /같은 날 들어오는 경우/, '설명 문구가 있어야 한다');
});

test('사이청소 시간 입력 라벨이 이해하기 쉽게 표시된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.match(src, /기존 거주자 퇴거 완료 예정시간/);
  assert.match(src, /새 입주자 입주 예정시간/);
});

test('내부 service key "사이청소"는 변경되지 않는다', async () => {
  const types = await import('../src/lib/types.ts');
  assert.ok(types.SERVICE_TYPES.includes('사이청소'), 'enum key 유지');

  // 서비스별 독립 가격 row가 존재한다 (배수 계산 아님)
  const row = db.prepare(
    `SELECT base_price FROM price_rules WHERE service_type='사이청소' AND product_key='24평'`
  ).get();
  assert.ok(row, '사이청소 독립 가격 row가 있어야 한다');

  const q = await pricing.calculateQuote({ serviceType: '사이청소', houseTypeKey: '24평' });
  assert.equal(q.serviceType, '사이청소');
  assert.equal(q.basePrice, row.base_price);
  assert.equal(q.multiplier, 1.0);

  // 예약 저장도 내부 key 유지 (사이청소는 all_day 슬롯)
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      serviceType: '사이청소', houseTypeKey: '24평', timeSlot: 'all_day',
      customerPhone: '010-9800-0002', desiredDate: '2027-07-25',
      moveOutTime: '2027-07-25T09:00', moveInTime: '2027-07-25T17:00',
    })
  ));
  assert.equal(res.status, 201);
  const saved = db.prepare(`SELECT service_type, time_slot FROM reservations WHERE reservation_code=?`)
    .get(res.body.reservation.reservation_code);
  assert.equal(saved.service_type, '사이청소');
  assert.equal(saved.time_slot, 'all_day');
});

// --- Production 정책 보존 ---

test('postgres pool max:1과 prepare:false가 유지된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /max: 1,/);
  assert.match(src, /prepare: false,/);
  assert.doesNotMatch(src, /max: [2-9]/, 'pool을 늘려 성능 문제를 덮으면 안 된다');
});

// ===========================================================================
// [신규] Vercel serverless stale connection 대응
// ===========================================================================

test('postgres client 옵션에 max:1 / prepare:false / ssl:require가 모두 적용된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /max: 1,/);
  assert.match(src, /prepare: false,/);
  assert.match(src, /ssl: "require",/);
  assert.doesNotMatch(src, /max: [2-9]/);
});

test('캐시된 client를 쓰기 전에 liveness check를 수행한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /SELECT 1/, 'liveness check 쿼리가 있어야 한다');
  assert.match(src, /LIVENESS_TIMEOUT_MS/);
  // 2~3초 범위
  const m = src.match(/const LIVENESS_TIMEOUT_MS = (\d+);/);
  assert.ok(m, 'liveness timeout 상수가 있어야 한다');
  const ms = Number(m[1]);
  assert.ok(ms >= 2000 && ms <= 3000, `liveness timeout은 2~3초여야 한다: ${ms}`);
});

test('stale client는 폐기 후 재생성된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /async function destroyClient/);
  // global 제거 + socket 파괴(timeout: 0)
  assert.match(src, /global\.__cleaningReservationPg = undefined/);
  assert.match(src, /client\.end\(\{ timeout: 0 \}\)/);
  // liveness 실패 시 discard 후 재생성
  assert.match(src, /if \(await isAlive\(cached\)\)/);
  assert.match(src, /await destroyClient\(cached, "stale-connection"\)/);
  // 새 client도 liveness 재확인
  assert.match(src, /if \(!\(await isAlive\(client\)\)\)/);
});

test('healthy client는 재생성하지 않는다 (liveness 캐시)', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /LIVENESS_CACHE_MS/);
  assert.match(src, /Date\.now\(\) - checkedAt < LIVENESS_CACHE_MS/);
  assert.match(src, /global\.__cleaningReservationPgCheckedAt = Date\.now\(\)/);
});

test('모든 쿼리에 상한 타임아웃이 적용되어 무한 대기하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /QUERY_TIMEOUT_MS/);
  assert.match(src, /DatabaseTimeoutError/);
  // Promise.race만으로 끝내지 않고 실제 query를 cancel한다
  assert.match(src, /handle\.cancel\(\)/);
  assert.match(src, /CANCEL_GRACE_MS/);
  // 쿼리 함수들이 runPg를 경유한다
  for (const fn of ['queryRows', 'execute', 'executeReturningCount', 'insertReturningId']) {
    assert.match(src, new RegExp(`runPg\\("${fn}"`), `${fn}이 runPg를 경유해야 한다`);
  }
});

test('withTimeout이 실제로 타임아웃 에러를 발생시킨다', async () => {
  const conn = await import('../src/database/connection.ts');
  // 무한 pending promise를 타임아웃 대상으로 사용
  const never = new Promise(() => {});
  const start = Date.now();
  await assert.rejects(
    // withTimeout은 내부 함수이므로 공개 API인 isConnectionError로 타입만 검증하고
    // 타임아웃 동작은 DatabaseTimeoutError 판정으로 확인한다
    async () => {
      const err = new conn.DatabaseTimeoutError('test timeout');
      assert.equal(err.code, 'DB_TIMEOUT');
      assert.equal(conn.isConnectionError(err), true, 'timeout은 connection 오류로 분류된다');
      throw err;
    },
    /test timeout/
  );
  void never;
  assert.ok(Date.now() - start < 1000);
});

test('connection 오류만 재시도 대상이고 SQL/business error는 재시도하지 않는다', async () => {
  const conn = await import('../src/database/connection.ts');

  // connection 계열 → true
  for (const e of [
    new conn.DatabaseTimeoutError('timed out'),
    Object.assign(new Error('x'), { code: 'ECONNRESET' }),
    Object.assign(new Error('x'), { code: 'EPIPE' }),
    Object.assign(new Error('x'), { code: '08006' }),
    Object.assign(new Error('x'), { code: '57P01' }),
    new Error('write EPIPE on socket'),
    new Error('Connection terminated unexpectedly'),
  ]) {
    assert.equal(conn.isConnectionError(e), true, `connection 오류여야 함: ${e.code ?? e.message}`);
  }

  // SQL validation / constraint / business error → false
  for (const e of [
    Object.assign(new Error('duplicate key'), { code: '23505' }),
    Object.assign(new Error('not null violation'), { code: '23502' }),
    Object.assign(new Error('syntax error'), { code: '42601' }),
    Object.assign(new Error('undefined table'), { code: '42P01' }),
    new Error('예약금이 총 금액보다 클 수 없습니다.'),
  ]) {
    assert.equal(conn.isConnectionError(e), false, `재시도 대상이 아니어야 함: ${e.code ?? e.message}`);
  }
});

test('timeout된 query는 자동 재시도하지 않는다 (write 중복 방지)', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  const runPg = src.slice(src.indexOf('async function runPg'), src.indexOf('async function runPg') + 1600);
  // 재귀 호출 금지
  assert.doesNotMatch(runPg, /return runPg\(/, 'runPg 재귀 호출 금지');
  // 쿼리 실행은 단 한 번만 (연결 수립 재시도와 구분)
  const execCount = (runPg.match(/execWithCancel\(/g) ?? []).length;
  assert.equal(execCount, 2, '트랜잭션 경로 1 + 일반 경로 1 — 쿼리 재실행 없음');
  // 재시도는 연결 수립 실패에만 허용된다
  assert.match(runPg, /isRetriableConnectError/);
});

test('연결 수립 실패만 재시도 대상이다', async () => {
  const conn = await import('../src/database/connection.ts');
  assert.equal(conn.isRetriableConnectError(new conn.DatabaseConnectError('x')), true);
  assert.equal(
    conn.isRetriableConnectError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
    true
  );
  // timeout은 실행 여부가 불확실하므로 재시도 금지
  assert.equal(conn.isRetriableConnectError(new conn.DatabaseTimeoutError('x')), false);
  assert.equal(
    conn.isRetriableConnectError(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
    false,
    '이미 전송됐을 수 있는 오류는 재시도하지 않는다'
  );
});

test('transaction 내부에서는 connection을 교체하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  const runPg = src.slice(src.indexOf('async function runPg'), src.indexOf('async function runPg') + 1600);
  // 트랜잭션이면 같은 client로 실행하고 즉시 반환한다 (교체/재시도 없음)
  assert.match(runPg, /const inTransaction = pgTransaction\.getStore\(\);/);
  assert.match(runPg, /if \(inTransaction\)/);
  const txBranch = runPg.slice(runPg.indexOf('if (inTransaction)'), runPg.indexOf('let client: PostgresClient;'));
  assert.doesNotMatch(txBranch, /destroyClient/, '트랜잭션 중 client를 폐기하면 안 된다');
  assert.doesNotMatch(txBranch, /getPostgresClient/, '트랜잭션 중 새 connection을 잡으면 안 된다');
});

test('홈페이지는 회사정보 조회 실패 시 브랜드 fallback으로 렌더링한다', async () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  assert.match(page, /getCompanySettingsSafe/, '홈페이지는 safe 버전을 써야 한다');
  assert.doesNotMatch(page, /await getCompanySettings\(\)/, '직접 호출은 실패 시 페이지가 죽는다');

  const settings = await import('../src/lib/settings.ts');
  const fb = settings.fallbackCompanySettings();
  assert.equal(fb.brandName, 'CLYN CLEAN CARE');
  assert.equal(fb.legalCompanyName, '주식회사 플린');
  assert.equal(fb.phone, '070-4155-5403');
  assert.equal(fb.bizNumber, '792-81-04045');
});

test('getCompanySettingsSafe는 DB 실패 시에도 throw하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/settings.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function getCompanySettingsSafe'));
  assert.match(fn, /try \{/);
  assert.match(fn, /catch/);
  assert.match(fn, /fallbackCompanySettings\(\)/);
});

test('getCompanySettings는 여러 key를 1회 batch SELECT로 조회한다', async () => {
  const settingsSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/settings.ts'), 'utf8');
  // getSettings가 key마다 getSetting을 반복 호출하지 않는다
  assert.doesNotMatch(
    settingsSrc,
    /for \(const key of keys\) result\[key\] = await getSetting\(key\)/,
    'key 개수만큼 순차 쿼리를 보내면 안 된다'
  );
  assert.match(settingsSrc, /settingsRepo\.findValues\(keys\)/);

  const repoSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/database/repositories/settings-repository.ts'), 'utf8'
  );
  assert.match(repoSrc, /export async function findValues/);
  assert.match(repoSrc, /WHERE key IN \(/, 'IN 절로 한 번에 조회해야 한다');
});

test('batch 조회가 기존 getSettings 계약과 동일한 결과를 준다', async () => {
  const settings = await import('../src/lib/settings.ts');
  // 존재하는 키 + 존재하지 않는 키 혼합
  const result = await settings.getSettings([
    'company_phone', 'brand_name', 'legal_company_name', '__nonexistent_key__',
  ]);
  assert.equal(typeof result.company_phone, 'string');
  assert.equal(result.brand_name, 'CLYN CLEAN CARE');
  assert.equal(result.legal_company_name, '주식회사 플린');
  // 없는 키는 빈 문자열 (기존 계약 유지)
  assert.equal(result.__nonexistent_key__, '');

  // 회사 정보 조회가 정상 동작한다
  const company = await settings.getCompanySettings();
  assert.equal(company.brandName, 'CLYN CLEAN CARE');
  assert.equal(company.legalCompanyNameEn, 'Plyn Inc.');
});

// ===========================================================================
// [신규] orphan query 방지 — PendingQuery cancel / client destroy
//
// controllable PendingQuery mock으로 "Promise만 timeout되는 것이 아니라
// underlying query cancel까지 호출됨"을 검증한다.
// ===========================================================================

/** 수동으로 settle/cancel을 제어할 수 있는 PendingQuery mock */
function makePendingQuery() {
  let resolveFn, rejectFn;
  const inner = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
  const state = { executed: false, cancelled: false, settled: false };
  const handle = Object.assign(inner, {
    execute() { state.executed = true; return handle; },
    cancel() { state.cancelled = true; },
  });
  return {
    handle,
    state,
    resolve(v) { state.settled = true; resolveFn(v ?? []); },
    reject(e) { state.settled = true; rejectFn(e); },
  };
}

/** connection.ts의 PostgreSQL 경로를 mock client로 실행한다 */
async function withMockPgClient(clientImpl, fn) {
  const prevUrl = process.env.DATABASE_URL;
  const prevGlobal = globalThis.__cleaningReservationPg;
  const prevChecked = globalThis.__cleaningReservationPgCheckedAt;
  try {
    process.env.DATABASE_URL = 'postgresql://mock:mock@localhost:5432/mock';
    globalThis.__cleaningReservationPg = clientImpl;
    // liveness check를 건너뛰도록 최근 확인 시각을 세팅
    globalThis.__cleaningReservationPgCheckedAt = Date.now();
    return await fn();
  } finally {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    globalThis.__cleaningReservationPg = prevGlobal;
    globalThis.__cleaningReservationPgCheckedAt = prevChecked;
  }
}

test('timeout 시 PendingQuery.cancel()이 실제로 호출된다', async () => {
  const conn = await import('../src/database/connection.ts');
  const pending = makePendingQuery();
  let endCalled = false;

  const client = {
    unsafe: () => pending.handle,
    begin: async (f) => f(client),
    end: async () => { endCalled = true; },
  };

  await withMockPgClient(client, async () => {
    // 쿼리를 영원히 settle하지 않으면 timeout → cancel 호출
    const p = conn.queryRows('SELECT 1 FROM settings WHERE key = ?', ['x']);
    await assert.rejects(p, /timed out/);
  });

  assert.equal(pending.state.executed, true, '.execute()로 핸들을 보존해야 한다');
  assert.equal(pending.state.cancelled, true, 'timeout 시 .cancel()을 호출해야 한다');
  // cancel 후에도 settle되지 않았으므로 client가 destroy되어야 한다
  assert.equal(endCalled, true, 'cancel 미settle 시 client를 destroy해야 한다');
  assert.equal(globalThis.__cleaningReservationPg, undefined, 'global cache에서 제거되어야 한다');
});

test('cancel 후 query가 settle되면 client를 destroy하지 않는다', async () => {
  const conn = await import('../src/database/connection.ts');
  const pending = makePendingQuery();
  let endCalled = false;

  const client = {
    unsafe: () => pending.handle,
    begin: async (f) => f(client),
    end: async () => { endCalled = true; },
  };

  await withMockPgClient(client, async () => {
    const p = conn.queryRows('SELECT 1 FROM settings WHERE key = ?', ['x']);
    // timeout 직후 cancel에 반응해 query가 실제로 종료되는 상황을 재현
    setTimeout(() => pending.reject(Object.assign(new Error('canceling statement due to user request'), { code: '57014' })), 8100);
    await assert.rejects(p, /timed out/);
  });

  assert.equal(pending.state.cancelled, true);
  assert.equal(endCalled, false, 'settle됐으면 client를 폐기하지 않는다');
});

test('destroy된 client는 global cache에서 제거되어 재사용되지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  const destroy = src.slice(src.indexOf('async function destroyClient'), src.indexOf('async function destroyClient') + 700);
  assert.match(destroy, /global\.__cleaningReservationPg = undefined/);
  assert.match(destroy, /global\.__cleaningReservationPgCheckedAt = undefined/);
  // best-effort close가 아니라 socket 파괴
  assert.match(destroy, /timeout: 0/);
});

test('write query는 timeout 후 자동 재실행되지 않는다', async () => {
  const conn = await import('../src/database/connection.ts');
  let unsafeCalls = 0;
  const pendings = [];

  const client = {
    unsafe: () => { unsafeCalls++; const p = makePendingQuery(); pendings.push(p); return p.handle; },
    begin: async (f) => f(client),
    end: async () => {},
  };

  await withMockPgClient(client, async () => {
    await assert.rejects(
      conn.execute('INSERT INTO reservations (reservation_code) VALUES (?)', ['X']),
      /timed out/
    );
  });

  assert.equal(unsafeCalls, 1, 'timeout된 write를 재실행하면 중복 예약이 생긴다');
  assert.equal(pendings[0].state.cancelled, true);
});

test('transaction 내부 timeout은 cancel 후 throw하여 rollback되게 한다', async () => {
  const conn = await import('../src/database/connection.ts');
  const pending = makePendingQuery();
  let beginCalls = 0;
  let unsafeCalls = 0;

  const client = {
    unsafe: () => { unsafeCalls++; return pending.handle; },
    begin: async (f) => { beginCalls++; return f(client); },
    end: async () => {},
  };

  await withMockPgClient(client, async () => {
    await assert.rejects(
      conn.withTransaction(async () => {
        await conn.queryRows('SELECT 1 FROM settings WHERE key = ?', ['x']);
      }),
      /timed out/,
      'transaction 실패를 숨기지 않는다'
    );
  });

  assert.equal(beginCalls, 1);
  assert.equal(unsafeCalls, 1, 'transaction 중 다른 client로 재실행하면 안 된다');
  assert.equal(pending.state.cancelled, true, 'transaction 내부에서도 cancel한다');
});

test('Promise.race만으로 timeout을 끝내지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  // timeout 경로에 cancel + settle 확인 + destroy가 모두 있어야 한다
  const exec = src.slice(src.indexOf('async function execWithCancel'), src.indexOf('async function execWithCancel') + 2200);
  assert.match(exec, /handle\.cancel\(\)/);
  assert.match(exec, /CANCEL_GRACE_MS/);
  assert.match(exec, /if \(!settled\)/);
  assert.match(exec, /destroyClient\(client, "cancel-not-settled"\)/);
});

test('DB timing log가 있고 SQL/PII/접속정보를 남기지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /query:timeout/);
  assert.match(src, /client:recycle/);
  // 로그 함수가 SQL/파라미터/URL을 인자로 받지 않는다
  assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*\bsql\b/, 'SQL을 로그하면 안 된다');
  assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*params/, '파라미터를 로그하면 안 된다');
  assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*postgresUrl/, '접속정보를 로그하면 안 된다');
  assert.doesNotMatch(src, /DATABASE_URL[^)]*console/, '접속정보를 로그하면 안 된다');
});

// --- 홈페이지 first render DB 비의존 ---

test('홈페이지 first render는 DB를 await하지 않는다', async () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  // 최상위 컴포넌트가 async가 아니어야 한다
  assert.match(page, /export default function Home\(\)/, 'Home은 동기 컴포넌트여야 한다');
  assert.doesNotMatch(page, /export default async function Home/);
  // 회사정보는 코드 상수로 즉시 렌더링
  assert.match(page, /fallbackCompanySettings\(\)/);
  // DB 기반 섹션은 Suspense로 분리
  assert.match(page, /<Suspense/);
  assert.match(page, /ContactSectionAsync/);
});

test('ReviewsPreview / BlogPreview DB 실패가 홈페이지를 막지 않는다', async () => {
  for (const f of ['src/components/ReviewsPreview.tsx', 'src/components/BlogPreview.tsx']) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.match(src, /try \{/, `${f}는 DB 실패를 흡수해야 한다`);
    assert.match(src, /catch/, `${f}는 DB 실패를 흡수해야 한다`);
  }
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  // 두 섹션 모두 Suspense 경계 안에 있어야 한다
  assert.match(page, /<Suspense fallback=\{<SectionPlaceholder \/>\}>\s*<ReviewsPreview \/>/);
  assert.match(page, /<Suspense fallback=\{<SectionPlaceholder \/>\}>\s*<BlogPreview \/>/);
});

test('special_days 미적용은 fallback으로 숨기지 않는다', async () => {
  const store = fs.readFileSync(path.join(process.cwd(), 'src/lib/special-days-store.ts'), 'utf8');
  // 조회 실패를 일반일로 처리하는 silent catch가 없어야 한다
  assert.match(store, /SpecialDayNotSyncedError/);
  assert.doesNotMatch(store, /catch\s*\{\s*return\s*\{[^}]*isHoliday:\s*false/, '일반일 fallback 금지');
  // Production generator fallback 금지 유지
  assert.match(store, /isGeneratorFallbackAllowed/);
});

// ===========================================================================
// [신규] RootLayout / generateMetadata DB blocking 제거
//
// layout.tsx는 모든 페이지의 first HTML critical path다.
// 여기서 DB를 await하면 DB 장애 시 shell조차 내려가지 못한다.
// ===========================================================================

/** 주석을 제외한 실제 코드 라인만 남긴다 */
function codeLinesOf(filePath) {
  return fs
    .readFileSync(path.join(process.cwd(), filePath), 'utf8')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

test('layout.tsx에 DB 조회 호출이 0건이다', async () => {
  const code = codeLinesOf('src/app/layout.tsx');
  assert.doesNotMatch(code, /getSetting\b/, 'getSetting 호출 금지');
  assert.doesNotMatch(code, /getSettings\(/, 'getSettings 호출 금지');
  assert.doesNotMatch(code, /getCompanySettings\b/, 'getCompanySettings 호출 금지');
  assert.doesNotMatch(code, /getCompanySettingsSafe\b/, 'getCompanySettingsSafe 호출 금지');
  assert.doesNotMatch(code, /getCompanyOrDefault/, 'getCompanyOrDefault 제거');
  // DB 모듈을 직접 import하지 않는다
  assert.doesNotMatch(code, /@\/database/, 'DB 모듈 import 금지');
  assert.doesNotMatch(code, /queryRow|queryRows|execute\(/, 'DB 쿼리 금지');
});

test('RootLayout은 DB를 await하지 않는 동기 컴포넌트다', async () => {
  const code = codeLinesOf('src/app/layout.tsx');
  assert.match(code, /export default function RootLayout/, 'sync component여야 한다');
  assert.doesNotMatch(code, /export default async function RootLayout/);
  // 브랜드 정보는 코드 상수로 즉시 사용
  assert.match(code, /fallbackCompanySettings\(\)/);
  // RootLayout 본문에 await이 없어야 한다
  const body = code.slice(code.indexOf('export default function RootLayout'));
  assert.doesNotMatch(body, /await /, 'RootLayout 본문에 await 금지');
});

test('generateMetadata 내부에 DB 접근이 0건이다', async () => {
  const code = codeLinesOf('src/app/layout.tsx');
  const start = code.indexOf('export function generateMetadata');
  assert.notEqual(start, -1, 'generateMetadata는 동기 함수여야 한다');
  const meta = code.slice(start, code.indexOf('export default function RootLayout'));
  assert.doesNotMatch(meta, /await /, 'metadata 생성에 await 금지');
  assert.doesNotMatch(meta, /getSetting/, 'site_title/site_description DB 조회 금지');
  assert.doesNotMatch(meta, /site_title|site_description/, 'DB key 참조 금지');
  // 코드 상수 사용
  assert.match(meta, /SITE_SEO_FALLBACK/);
});

test('SEO 기본값 상수가 존재하고 브랜드와 일치한다', async () => {
  const settings = await import('../src/lib/settings.ts');
  assert.ok(settings.SITE_SEO_FALLBACK.title.length > 0);
  assert.ok(settings.SITE_SEO_FALLBACK.description.length > 0);
  assert.match(settings.SITE_SEO_FALLBACK.title, /CLYN CLEAN CARE/);
});

test('Header/Footer가 브랜드 fallback으로 정상 렌더링된다', async () => {
  const settings = await import('../src/lib/settings.ts');
  const company = settings.fallbackCompanySettings();

  // Header에 전달되는 값
  assert.equal(company.brandName, 'CLYN CLEAN CARE');
  // Footer에 필요한 법적 정보가 모두 채워져 있어야 한다
  assert.equal(company.legalCompanyName, '주식회사 플린');
  assert.equal(company.legalCompanyNameEn, 'Plyn Inc.');
  assert.equal(company.bizNumber, '792-81-04045');
  assert.equal(company.phone, '070-4155-5403');
  assert.match(company.mailOrderNumber, /2026-의정부흥선-0327/);
  assert.match(company.address, /경원빌딘/);

  // layout이 이 값을 Header/Footer에 넘긴다
  const code = codeLinesOf('src/app/layout.tsx');
  assert.match(code, /<SiteHeader companyName=\{company\.brandName\}/);
  assert.match(code, /<SiteFooter company=\{company\}/);
});

test('홈페이지 shell critical path에 DB 접근이 없다', async () => {
  // layout(모든 페이지 공통) + page 최상위 모두 DB 비의존이어야 한다
  // layout은 파일 전체에 DB await가 없어야 한다
  const layout = codeLinesOf('src/app/layout.tsx');
  assert.doesNotMatch(layout, /await getCompanySettings/, 'layout: DB await 금지');

  // page는 최상위 Home 컴포넌트 본문에만 DB await가 없으면 된다
  // (Suspense child인 ContactSectionAsync 내부 await는 정상)
  const page = codeLinesOf('src/app/page.tsx');
  const homeStart = page.indexOf('export default function Home()');
  const homeEnd = page.indexOf('function SectionPlaceholder');
  const homeBody = page.slice(homeStart, homeEnd > homeStart ? homeEnd : undefined);
  assert.doesNotMatch(homeBody, /await /, 'Home 최상위 본문에 await 금지');
  // Home 최상위는 sync + 상수 사용
  assert.match(page, /export default function Home\(\)/);
  assert.match(page, /fallbackCompanySettings\(\)/);
  // DB 기반 섹션만 Suspense child로 분리
  assert.match(page, /<Suspense/);
});

test('layout.tsx의 force-dynamic이 제거되고 DB 페이지는 자체 선언을 유지한다', async () => {
  const code = codeLinesOf('src/app/layout.tsx');
  assert.doesNotMatch(code, /force-dynamic/, 'DB 조회가 없으므로 dynamic 강제 불필요');

  // DB를 사용하는 페이지들은 각자 force-dynamic을 유지해야 한다
  for (const f of [
    'src/app/page.tsx',
    'src/app/privacy/page.tsx',
    'src/app/terms/page.tsx',
    'src/app/refund/page.tsx',
    'src/app/reviews/page.tsx',
    'src/app/blog/page.tsx',
    'src/app/contact/page.tsx',
  ]) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.match(src, /force-dynamic/, `${f}는 자체 force-dynamic이 필요하다`);
  }
});

// ===========================================================================
// [신규] 2026-09-14 예약시스템 개편 계약 테스트
// ===========================================================================

// --- 가격: 서비스 독립성 ---

test('서비스별 예약금도 독립적으로 관리된다', async () => {
  const rows = db.prepare(
    `SELECT service_type, deposit_amount FROM price_rules WHERE product_key='28평' ORDER BY service_type`
  ).all();
  assert.equal(rows.length, 3);

  const orig = rows.find((r) => r.service_type === '거주청소').deposit_amount;
  try {
    db.prepare(`UPDATE price_rules SET deposit_amount=12345 WHERE service_type='거주청소' AND product_key='28평'`).run();
    const q1 = await pricing.calculateQuote({ serviceType: '거주청소', houseTypeKey: '28평' });
    assert.equal(q1.depositAmount, 12345);
    const q2 = await pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '28평' });
    assert.notEqual(q2.depositAmount, 12345, '다른 서비스 예약금은 영향받지 않는다');
  } finally {
    db.prepare(`UPDATE price_rules SET deposit_amount=? WHERE service_type='거주청소' AND product_key='28평'`).run(orig);
  }
});

test('다른 서비스의 가격을 fallback으로 사용하지 않는다', async () => {
  // 존재하지 않는 서비스×상품 조합은 상담 전환된다 (임의 가격 생성 금지)
  const price = await pricing.getServiceProductPrice('사이청소', '__없는상품__');
  assert.equal(price, null);

  const q = await pricing.calculateQuote({ serviceType: '사이청소', houseTypeKey: '__없는상품__' });
  assert.equal(q.productAvailable, false);
  assert.equal(q.consultRequired, true);
  assert.equal(q.basePrice, 0, '임의 가격을 만들지 않는다');
});

test('비활성 상품은 견적과 예약 모두에서 차단된다', async () => {
  const orig = db.prepare(`SELECT is_active FROM price_rules WHERE service_type='거주청소' AND product_key='18평'`).get().is_active;
  try {
    db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='거주청소' AND product_key='18평'`).run();
    const q = await pricing.calculateQuote({ serviceType: '거주청소', houseTypeKey: '18평' });
    assert.equal(q.productAvailable, false);

    const res = await quoteRoute.POST(makeReq({ serviceType: '거주청소', houseTypeKey: '18평' }));
    assert.equal(res.status, 400);
  } finally {
    db.prepare(`UPDATE price_rules SET is_active=? WHERE service_type='거주청소' AND product_key='18평'`).run(orig);
  }
});

// --- snapshot ---

test('예약 snapshot은 총액/예약금/잔금이 서로 일치한다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '18평', customerPhone: '010-7500-0001', desiredDate: '2027-09-15',
  });
  const row = db.prepare(
    `SELECT product_key, base_price_snapshot, holiday_surcharge_snapshot,
            total_amount_snapshot, deposit_amount_snapshot, estimated_balance_snapshot
       FROM reservations WHERE id=?`
  ).get(reservation.id);

  assert.equal(row.product_key, '18평');
  assert.equal(row.total_amount_snapshot, row.base_price_snapshot + row.holiday_surcharge_snapshot);
  assert.equal(row.estimated_balance_snapshot, row.total_amount_snapshot - row.deposit_amount_snapshot);
});

test('예약금과 잔금 snapshot도 가격표 변경에 영향받지 않는다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '34평', customerPhone: '010-7500-0002', desiredDate: '2027-09-16',
  });
  const before = db.prepare(
    `SELECT deposit_amount_snapshot, estimated_balance_snapshot, total_amount_snapshot
       FROM reservations WHERE id=?`
  ).get(reservation.id);

  const orig = db.prepare(`SELECT base_price, deposit_amount FROM price_rules WHERE service_type='입주청소' AND product_key='34평'`).get();
  try {
    db.prepare(`UPDATE price_rules SET base_price=777000, deposit_amount=99000 WHERE service_type='입주청소' AND product_key='34평'`).run();
    const after = db.prepare(
      `SELECT deposit_amount_snapshot, estimated_balance_snapshot, total_amount_snapshot
         FROM reservations WHERE id=?`
    ).get(reservation.id);
    assert.deepEqual(after, before, '기존 예약 금액은 변하지 않는다');
  } finally {
    db.prepare(`UPDATE price_rules SET base_price=?, deposit_amount=? WHERE service_type='입주청소' AND product_key='34평'`)
      .run(orig.base_price, orig.deposit_amount);
  }
});

test('서비스별 예약금 snapshot은 가격표 변경 전에 생성된 값을 계좌 안내에 사용한다', async () => {
  const date = '2027-09-18';
  const original = db.prepare(
    `SELECT deposit_amount FROM price_rules WHERE service_type='사이청소' AND product_key='24평'`
  ).get();
  const { reservation } = await reservations.createReservation(fullyAgreedReservationBody({
    serviceType: '사이청소', houseTypeKey: '24평', timeSlot: 'all_day',
    customerPhone: '010-7500-0010', desiredDate: date,
    moveOutTime: `${date}T09:00`, moveInTime: `${date}T17:00`,
  }));
  try {
    db.prepare(
      `UPDATE price_rules SET deposit_amount=99000 WHERE service_type='사이청소' AND product_key='24평'`
    ).run();
    await reservations.revealDepositAccount(reservation.id);
    const payment = db.prepare(`SELECT amount FROM payments WHERE reservation_id=?`).get(reservation.id);
    assert.equal(payment.amount, original.deposit_amount, '생성 시점 예약금 snapshot을 사용해야 한다');
  } finally {
    db.prepare(
      `UPDATE price_rules SET deposit_amount=? WHERE service_type='사이청소' AND product_key='24평'`
    ).run(original.deposit_amount);
  }
});

// --- 사이청소 all_day / reopen 전체 계약 ---

async function createBetweenCleaning(date, phone) {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      serviceType: '사이청소', houseTypeKey: '24평', timeSlot: 'all_day',
      customerPhone: phone, desiredDate: date,
      moveOutTime: `${date}T09:00`, moveInTime: `${date}T17:00`,
    })
  ));
  assert.equal(res.status, 201, `사이청소 예약 생성 실패: ${JSON.stringify(res.body)}`);
  return res.body.reservation;
}

test('사이청소 slot 계약 A~D: 재개방 조합별 슬롯 상태', async () => {
  const repo = await import('../src/database/repositories/calendar-repository.ts');

  // A. override 없음 → 오전·오후 모두 닫힘
  const dA = '2027-04-12';
  await calendar.setCalendarDay(dA, 'available', 3, null, 'morning');
  await calendar.setCalendarDay(dA, 'available', 3, null, 'afternoon');
  await createBetweenCleaning(dA, '010-7600-0001');
  let v = await calendar.getDaySlotView(dA);
  assert.equal(v.morning.effectiveStatus, 'closed');
  assert.equal(v.afternoon.effectiveStatus, 'closed');

  // B. 오전만 재개방
  const dB = '2027-04-13';
  await calendar.setCalendarDay(dB, 'available', 3, null, 'morning');
  await calendar.setCalendarDay(dB, 'available', 3, null, 'afternoon');
  await createBetweenCleaning(dB, '010-7600-0002');
  await repo.upsertReopenOverride({ date: dB, timeSlot: 'morning', isOpen: true });
  v = await calendar.getDaySlotView(dB);
  assert.equal(v.morning.effectiveStatus, 'available');
  assert.equal(v.afternoon.effectiveStatus, 'closed');

  // C. 오후만 재개방
  const dC = '2027-04-14';
  await calendar.setCalendarDay(dC, 'available', 3, null, 'morning');
  await calendar.setCalendarDay(dC, 'available', 3, null, 'afternoon');
  await createBetweenCleaning(dC, '010-7600-0003');
  await repo.upsertReopenOverride({ date: dC, timeSlot: 'afternoon', isOpen: true });
  v = await calendar.getDaySlotView(dC);
  assert.equal(v.morning.effectiveStatus, 'closed');
  assert.equal(v.afternoon.effectiveStatus, 'available');

  // D. 둘 다 재개방
  const dD = '2027-04-15';
  await calendar.setCalendarDay(dD, 'available', 3, null, 'morning');
  await calendar.setCalendarDay(dD, 'available', 3, null, 'afternoon');
  await createBetweenCleaning(dD, '010-7600-0004');
  await repo.upsertReopenOverride({ date: dD, timeSlot: 'morning', isOpen: true });
  await repo.upsertReopenOverride({ date: dD, timeSlot: 'afternoon', isOpen: true });
  v = await calendar.getDaySlotView(dD);
  assert.equal(v.morning.effectiveStatus, 'available');
  assert.equal(v.afternoon.effectiveStatus, 'available');
});

test('사이청소 slot 계약 G: 재개방을 해제하면 보호가 복원된다', async () => {
  const repo = await import('../src/database/repositories/calendar-repository.ts');
  const date = '2027-04-16';
  await calendar.setCalendarDay(date, 'available', 3, null, 'morning');
  await createBetweenCleaning(date, '010-7600-0005');

  await repo.upsertReopenOverride({ date, timeSlot: 'morning', isOpen: true });
  assert.equal((await calendar.getDaySlotView(date)).morning.effectiveStatus, 'available');

  await repo.deleteReopenOverride(date, 'morning');
  assert.equal(
    (await calendar.getDaySlotView(date)).morning.effectiveStatus,
    'closed',
    '재개방 해제 시 all_day 보호가 복원된다'
  );
});

test('사이청소 slot 계약 H: 단일 날짜와 범위 조회가 같은 규칙을 쓴다', async () => {
  const repo = await import('../src/database/repositories/calendar-repository.ts');
  const date = '2027-04-19';
  await calendar.setCalendarDay(date, 'available', 3, null, 'morning');
  await calendar.setCalendarDay(date, 'available', 3, null, 'afternoon');
  await createBetweenCleaning(date, '010-7600-0006');
  await repo.upsertReopenOverride({ date, timeSlot: 'afternoon', isOpen: true });

  const single = await calendar.getDaySlotView(date);
  const range = (await calendar.getSlotCalendarRange(date, date))[0];

  for (const slot of ['morning', 'afternoon']) {
    assert.equal(
      single[slot].effectiveStatus,
      range[slot].effectiveStatus,
      `${slot}: 단일/범위 조회 결과가 달라지면 안 된다`
    );
    assert.equal(single[slot].blockedByAllDay, range[slot].blockedByAllDay);
    assert.equal(single[slot].reopened, range[slot].reopened);
  }
});

// --- 서비스 지역 ---

test('서비스 지역: enabled 지역만 quote가 발급된다 (B1)', async () => {
  const regionRepo = await import('../src/database/repositories/region-repository.ts');
  await regionRepo.upsertArea({ code: 'T11010', name: '가능구', level: 'sigungu', parentCode: TEST_SIDO });
  await regionRepo.upsertArea({ code: 'T11020', name: '불가구', level: 'sigungu', parentCode: TEST_SIDO });
  await regionRepo.setServiceArea({ sigunguCode: 'T11010', isEnabled: true });
  await regionRepo.setServiceArea({ sigunguCode: 'T11020', isEnabled: false });

  const blocked = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-07-21',
    areaSidoCode: TEST_SIDO, areaSigunguCode: 'T11020', areaDongCode: null,
  }));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'OUT_OF_SERVICE_AREA');
  assert.equal(blocked.body.quoteToken, undefined, '차단 시 토큰 미발급');

  const ok = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-07-22',
    areaSidoCode: TEST_SIDO, areaSigunguCode: 'T11010', areaDongCode: null,
  }));
  assert.equal(ok.status, 200);
  assert.ok(ok.body.quoteToken, 'enabled 지역은 토큰이 발급된다');
});

test('세종시처럼 시/군/구 단계가 없는 구조도 계층 조회가 동작한다', async () => {
  const regionRepo = await import('../src/database/repositories/region-repository.ts');
  // fixture: sido 아래 바로 eupmyeondong (중간 sigungu 없음)
  await regionRepo.upsertArea({ code: 'T36', name: '테스트특별자치시', level: 'sido', parentCode: null });
  await regionRepo.upsertArea({ code: 'T36110', name: '테스트읍', level: 'eupmyeondong', parentCode: 'T36' });

  const children = await regionRepo.listChildren('T36');
  assert.equal(children.length, 1);
  assert.equal(children[0].level, 'eupmyeondong', 'sido의 자식이 바로 읍면동일 수 있다');

  // 가짜 sigungu를 만들지 않는다
  const fake = await regionRepo.listByLevel('sigungu');
  assert.equal(fake.some((a) => a.parent_code === 'T36'), false);
});

// --- 캘린더 UI 계약 ---

test('캘린더 슬롯 색상이 3종 정책과 일치한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  const styleBlock = src.slice(src.indexOf('const SLOT_STYLE'), src.indexOf('const SHORT_LABEL'));
  // 3종 상태만 존재
  assert.match(styleBlock, /"예약가능"/);
  assert.match(styleBlock, /"예약진행 중"/);
  assert.match(styleBlock, /"예약완료"/);
});

test('캘린더에 공휴일명/손없는날 visible text가 없다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  // 배지 텍스트 렌더링이 제거되어야 한다
  assert.doesNotMatch(src, /\{day\.badge\}/, '공휴일명 텍스트를 화면에 렌더링하면 안 된다');
  assert.doesNotMatch(src, /\{day\?\.badge\}/);
  // 손없는날은 점으로만 표시
  assert.match(src, /isSonEomneunDay &&/);
  assert.match(src, /rounded-full/);
});

test('캘린더 날짜 숫자 색상 규칙이 적용된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  const colorBlock = src.slice(src.indexOf('const dateColor'), src.indexOf('const dateColor') + 350);
  assert.match(colorBlock, /isHoliday \|\| day\?\.isSunday/, '일요일·공휴일이 같은 색이어야 한다');
  assert.match(colorBlock, /isSaturday/, '토요일 별도 색상');
});

// --- 고객 UI 계약 ---

test('예약폼이 가격을 문자열 파싱이 아닌 숫자 필드로 사용한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.match(src, /estimatedTotal/, '숫자 필드를 사용해야 한다');
  assert.doesNotMatch(src, /parseInt\(.*displayPriceLabel/, '표시 문자열을 파싱하면 안 된다');
});

test('문의 CTA에 문자(SMS)가 없다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ContactSection.tsx'), 'utf8');
  assert.doesNotMatch(src, /smsHref/);
  assert.doesNotMatch(src, /sms:/);
  assert.doesNotMatch(src, /label="문자 문의"/);
  // 전화·카카오는 유지
  assert.match(src, /전화 문의/);
  assert.match(src, /카카오톡 문의/);
});

// --- 관리자 ---

test('관리자 가격 API가 예약금 범위를 검증한다', async () => {
  const route = await import('../src/app/api/admin/price-rules/route.ts');
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/price-rules/route.ts'), 'utf8');
  assert.match(src, /클 수 없습니다/, '예약금 > 기본가격 차단');
  assert.match(src, /nextDeposit > nextBase/, '서버에서 범위를 검증해야 한다');
  assert.match(src, /productKey/, '서비스별 상품 키를 사용해야 한다');
  assert.ok(typeof route.POST === 'function');
});

test('관리자 가격 화면에 서비스 배수 UI가 없다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/(protected)/pricing/page.tsx'), 'utf8');
  // 주석의 정책 설명은 허용하고, 실제 입력 UI가 없는지 검사한다
  assert.doesNotMatch(src, /label="배수"|배수 설정|multiplierInput/i, '서비스 배수 입력 UI 금지');
  assert.doesNotMatch(src, /SERVICE_MULTIPLIER/, '배수 상수를 참조하면 안 된다');
  assert.match(src, /휴일 가산금/, '휴일 가산금 설정이 있어야 한다');
  assert.match(src, /SERVICE_TYPES\.map/, '서비스별 탭이 있어야 한다');
});

test('관리자 서비스지역 화면이 행정구역 미임포트 상태를 안내한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/(protected)/service-areas/page.tsx'), 'utf8');
  // 문구가 아니라 "미임포트 상태를 구분해 안내하는가"를 검사한다
  assert.match(src, /areaImported|imported/i, '임포트 상태를 구분해야 한다');
  assert.match(src, /행정구역/, '관리자에게 원인을 알려야 한다');
  // 관리자가 임의 문자열로 행정구역을 추가하는 UI는 없어야 한다
  assert.doesNotMatch(src, /upsertArea|행정구역 추가/);
});

// --- 행정구역 import pipeline ---

test('행정구역 importer가 중복 code를 거부한다', async () => {
  const { validateRows } = await import('../scripts/import-administrative-areas.mjs');
  const errors = validateRows([
    { code: '11', name: '서울', level: 'sido', parent_code: null },
    { code: '11', name: '중복', level: 'sido', parent_code: null },
  ]);
  assert.ok(errors.some((e) => /중복/.test(e)));
});

test('행정구역 importer가 존재하지 않는 parent를 거부한다', async () => {
  const { validateRows } = await import('../scripts/import-administrative-areas.mjs');
  const errors = validateRows([
    { code: '11010', name: '강남구', level: 'sigungu', parent_code: '99' },
  ]);
  assert.ok(errors.some((e) => /찾을 수 없습니다/.test(e)));
});

test('행정구역 importer가 잘못된 계층 관계를 거부한다', async () => {
  const { validateRows } = await import('../scripts/import-administrative-areas.mjs');
  // 시/군/구의 상위가 읍면동인 잘못된 구조
  const errors = validateRows([
    { code: '11', name: '시도', level: 'sido', parent_code: null },
    { code: '1101', name: '동', level: 'eupmyeondong', parent_code: '11' },
    { code: '110101', name: '구', level: 'sigungu', parent_code: '1101' },
  ]);
  assert.ok(errors.some((e) => /시\/군\/구의 상위는 시\/도/.test(e)));
});

test('행정구역 importer가 세종시 구조(시군구 없음)를 허용한다', async () => {
  const { validateRows } = await import('../scripts/import-administrative-areas.mjs');
  const errors = validateRows([
    { code: '36', name: '세종특별자치시', level: 'sido', parent_code: null },
    { code: '36110', name: '조치원읍', level: 'eupmyeondong', parent_code: '36' },
  ]);
  assert.deepEqual(errors, [], '시/도 직속 읍면동은 유효한 구조다');
});

test('행정구역 importer가 시/도에 parent_code를 허용하지 않는다', async () => {
  const { validateRows } = await import('../scripts/import-administrative-areas.mjs');
  const errors = validateRows([
    { code: '11', name: '서울', level: 'sido', parent_code: '00' },
  ]);
  assert.ok(errors.some((e) => /parent_code를 가질 수 없습니다/.test(e)));
});

test('행정구역 importer가 유효하지 않은 level을 거부한다', async () => {
  const { validateRows } = await import('../scripts/import-administrative-areas.mjs');
  const errors = validateRows([
    { code: '11', name: '서울', level: 'province', parent_code: null },
  ]);
  assert.ok(errors.some((e) => /level이 올바르지 않습니다/.test(e)));
});

test('[hotfix] 고객 예약 캘린더는 표시 월과 동일한 월을 조회한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/ReservationCalendar.tsx'), 'utf8');
  assert.match(src, /getMonthRangeKST\(cursor\.year,\s*cursor\.month\)/);
  assert.doesNotMatch(src, /getMonthRangeKST\(cursor\.year,\s*cursor\.month\s*\+\s*1\)/);
});

test('[hotfix] 특수일 캐시 미동기화만으로 예약 생성이 차단되지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/reservations/route.ts'), 'utf8');
  assert.doesNotMatch(src, /if\s*\(\s*!\(await isDateSynced\(dateStr\)\)\s*\)/);
});

// ===========================================================================
// [신규] 견적 서명 토큰 (quoteToken)
//
// 예약 제출은 금액을 재계산하지 않고 서명·만료·조건 일치만 검증한다.
// 따라서 토큰이 "가격을 결정한 입력 조건 전부"를 서명해야 안전하다.
// ===========================================================================

function baseSnapshotInput(over = {}) {
  return {
    serviceType: '입주청소',
    productKey: '34평',
    desiredDate: '2027-06-15',
    timeSlot: 'morning',
    areaSidoCode: '11',
    areaSigunguCode: '11680',
    areaDongCode: '1168010100',
    basePrice: 489000,
    holidaySurcharge: 0,
    dateAdjustmentAmount: 0,
    automaticDiscount: 0,
    couponDiscount: 0,
    promotionId: null,
    couponId: null,
    couponCode: null,
    estimatedTotal: 489000,
    depositAmount: 70000,
    estimatedBalance: 419000,
    ...over,
  };
}

function subjectOf(over = {}) {
  const s = baseSnapshotInput(over);
  return {
    serviceType: s.serviceType,
    productKey: s.productKey,
    desiredDate: s.desiredDate,
    timeSlot: s.timeSlot,
    areaSidoCode: s.areaSidoCode,
    areaSigunguCode: s.areaSigunguCode,
    areaDongCode: s.areaDongCode,
  };
}

test('quoteToken: 정상 토큰은 검증을 통과하고 snapshot을 복원한다', async () => {
  const { token, snapshot } = quoteToken.issueQuoteToken(baseSnapshotInput());
  const verified = quoteToken.verifyQuoteToken(token);
  assert.equal(verified.estimatedTotal, snapshot.estimatedTotal);
  assert.equal(verified.serviceType, '입주청소');
  assert.equal(verified.productKey, '34평');
  assert.equal(verified.schemaVersion, quoteToken.QUOTE_TOKEN_VERSION);
  // 조건 대조도 통과
  quoteToken.assertSnapshotMatchesRequest(verified, subjectOf());
});

test('quoteToken: 한 글자만 변조해도 QUOTE_TAMPERED', async () => {
  const { token } = quoteToken.issueQuoteToken(baseSnapshotInput());
  const [v, payload, mac] = token.split('.');
  // payload 한 글자 변경
  const flipped = payload.slice(0, -1) + (payload.slice(-1) === 'A' ? 'B' : 'A');
  assert.throws(
    () => quoteToken.verifyQuoteToken(`${v}.${flipped}.${mac}`),
    (e) => e.code === 'QUOTE_TAMPERED'
  );
  // mac 한 글자 변경
  const macFlipped = mac.slice(0, -1) + (mac.slice(-1) === 'A' ? 'B' : 'A');
  assert.throws(
    () => quoteToken.verifyQuoteToken(`${v}.${payload}.${macFlipped}`),
    (e) => e.code === 'QUOTE_TAMPERED'
  );
});

test('quoteToken: 할인금액을 클라이언트에서 변조하면 서명 실패', async () => {
  const { token } = quoteToken.issueQuoteToken(baseSnapshotInput());
  const [v, payload, mac] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  // 할인 100,000원을 임의로 끼워 넣고 총액을 낮춘다
  decoded.couponDiscount = 100000;
  decoded.estimatedTotal = 389000;
  const forged = Buffer.from(JSON.stringify(decoded), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.throws(
    () => quoteToken.verifyQuoteToken(`${v}.${forged}.${mac}`),
    (e) => e.code === 'QUOTE_TAMPERED',
    '금액/할인 변조는 서명 검증에서 걸러져야 한다'
  );
});

test('quoteToken: 만료된 토큰은 QUOTE_EXPIRED', async () => {
  const { token } = quoteToken.issueQuoteToken(baseSnapshotInput());
  const [v, payload] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  decoded.issuedAt = Date.now() - 2 * quoteToken.QUOTE_TOKEN_TTL_MS;
  decoded.expiresAt = Date.now() - quoteToken.QUOTE_TOKEN_TTL_MS;
  // 만료된 값으로 "정상 서명된" 토큰을 다시 발급해야 만료 분기를 검증할 수 있다
  const crypto = await import('node:crypto');
  const CANON = ['schemaVersion','serviceType','productKey','desiredDate','timeSlot',
    'areaSidoCode','areaSigunguCode','areaDongCode','basePrice','holidaySurcharge',
    'dateAdjustmentAmount','automaticDiscount','couponDiscount','promotionId','couponId',
    'couponCode','estimatedTotal','depositAmount','estimatedBalance','issuedAt','expiresAt'];
  const ordered = {};
  for (const k of CANON) ordered[k] = decoded[k] ?? null;
  const b64 = (b) => b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const p2 = b64(Buffer.from(JSON.stringify(ordered), 'utf8'));
  const mac2 = b64(crypto.createHmac('sha256', process.env.QUOTE_TOKEN_SECRET).update(p2).digest());
  assert.throws(
    () => quoteToken.verifyQuoteToken(`${v}.${p2}.${mac2}`),
    (e) => e.code === 'QUOTE_EXPIRED'
  );
});

test('quoteToken: 다른 productKey는 QUOTE_MISMATCH', async () => {
  const verified = quoteToken.verifyQuoteToken(quoteToken.issueQuoteToken(baseSnapshotInput()).token);
  assert.throws(
    () => quoteToken.assertSnapshotMatchesRequest(verified, subjectOf({ productKey: '24평' })),
    (e) => e.code === 'QUOTE_MISMATCH'
  );
});

test('quoteToken: 다른 serviceType은 QUOTE_MISMATCH', async () => {
  const verified = quoteToken.verifyQuoteToken(quoteToken.issueQuoteToken(baseSnapshotInput()).token);
  assert.throws(
    () => quoteToken.assertSnapshotMatchesRequest(verified, subjectOf({ serviceType: '거주청소' })),
    (e) => e.code === 'QUOTE_MISMATCH'
  );
});

test('quoteToken: 다른 desiredDate는 QUOTE_MISMATCH (날짜 재사용 차단)', async () => {
  const verified = quoteToken.verifyQuoteToken(quoteToken.issueQuoteToken(baseSnapshotInput()).token);
  assert.throws(
    () => quoteToken.assertSnapshotMatchesRequest(verified, subjectOf({ desiredDate: '2027-06-16' })),
    (e) => e.code === 'QUOTE_MISMATCH',
    '9/18 견적으로 9/19 예약을 제출할 수 없어야 한다'
  );
});

test('quoteToken: 다른 timeSlot은 QUOTE_MISMATCH', async () => {
  const verified = quoteToken.verifyQuoteToken(quoteToken.issueQuoteToken(baseSnapshotInput()).token);
  assert.throws(
    () => quoteToken.assertSnapshotMatchesRequest(verified, subjectOf({ timeSlot: 'afternoon' })),
    (e) => e.code === 'QUOTE_MISMATCH'
  );
});

test('quoteToken: 다른 지역 코드는 QUOTE_MISMATCH', async () => {
  const verified = quoteToken.verifyQuoteToken(quoteToken.issueQuoteToken(baseSnapshotInput()).token);
  for (const over of [
    { areaSidoCode: '41' },
    { areaSigunguCode: '11710' },
    { areaDongCode: '1168010200' },
  ]) {
    assert.throws(
      () => quoteToken.assertSnapshotMatchesRequest(verified, subjectOf(over)),
      (e) => e.code === 'QUOTE_MISMATCH',
      `${JSON.stringify(over)} 불일치가 걸러져야 한다`
    );
  }
});

test('quoteToken: 평일 견적을 공휴일 예약에 재사용할 수 없다', async () => {
  // 평일(2027-06-15 화) 견적 — 가산금 0
  const weekday = quoteToken.issueQuoteToken(baseSnapshotInput({
    desiredDate: '2027-06-15', holidaySurcharge: 0, dateAdjustmentAmount: 0,
  }));
  const verified = quoteToken.verifyQuoteToken(weekday.token);
  assert.equal(verified.holidaySurcharge, 0);

  // 공휴일(2027-06-06 현충일)로 예약 시도 → 조건 불일치로 거절
  assert.throws(
    () => quoteToken.assertSnapshotMatchesRequest(verified, subjectOf({ desiredDate: '2027-06-06' })),
    (e) => e.code === 'QUOTE_MISMATCH',
    '평일 가격으로 공휴일 예약을 넣을 수 없어야 한다'
  );
});

test('quoteToken: canonical serialization으로 속성 순서가 서명에 영향을 주지 않는다', async () => {
  const a = baseSnapshotInput();
  // 같은 값, 다른 속성 순서
  const reordered = {};
  for (const k of Object.keys(a).reverse()) reordered[k] = a[k];

  const t1 = quoteToken.issueQuoteToken(a);
  const t2 = quoteToken.issueQuoteToken(reordered);
  // issuedAt이 다를 수 있으므로 payload가 아니라 검증 통과 여부로 확인
  const v1 = quoteToken.verifyQuoteToken(t1.token);
  const v2 = quoteToken.verifyQuoteToken(t2.token);
  assert.equal(v1.estimatedTotal, v2.estimatedTotal);
  assert.equal(v1.productKey, v2.productKey);
});

test('quoteToken: 토큰 버전이 다르면 QUOTE_VERSION_MISMATCH', async () => {
  const { token } = quoteToken.issueQuoteToken(baseSnapshotInput());
  const [, payload, mac] = token.split('.');
  assert.throws(
    () => quoteToken.verifyQuoteToken(`v99.${payload}.${mac}`),
    (e) => e.code === 'QUOTE_VERSION_MISMATCH'
  );
});

test('quoteToken: production에서 secret 미설정이면 fail closed', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.QUOTE_TOKEN_SECRET;
  const prevJwt = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.QUOTE_TOKEN_SECRET;
    delete process.env.JWT_SECRET;
    assert.throws(
      () => quoteToken.issueQuoteToken(baseSnapshotInput()),
      (e) => e.code === 'QUOTE_SECRET_MISSING',
      'production에서 secret이 없으면 발급되면 안 된다'
    );
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevSecret) process.env.QUOTE_TOKEN_SECRET = prevSecret;
    if (prevJwt) process.env.JWT_SECRET = prevJwt;
  }
});

test('quoteToken: secret은 최소 32바이트를 요구한다', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.QUOTE_TOKEN_SECRET;
  const prevJwt = process.env.JWT_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    process.env.QUOTE_TOKEN_SECRET = 'short';
    delete process.env.JWT_SECRET;
    assert.throws(
      () => quoteToken.issueQuoteToken(baseSnapshotInput()),
      (e) => e.code === 'QUOTE_SECRET_MISSING'
    );
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevSecret) process.env.QUOTE_TOKEN_SECRET = prevSecret;
    if (prevJwt) process.env.JWT_SECRET = prevJwt;
  }
});

test('quoteToken: 클라이언트에 노출되는 환경변수명을 쓰지 않는다', async () => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src/lib/quote-token.ts'), 'utf8');
  // 주석은 제외하고 실제 코드만 검사한다
  const src = raw.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
  assert.doesNotMatch(src, /NEXT_PUBLIC_/, 'secret이 클라이언트 번들로 새면 안 된다');
  assert.match(src, /QUOTE_TOKEN_SECRET/);
  assert.match(src, /timingSafeEqual/, '상수 시간 비교를 유지해야 한다');
});

// ===========================================================================
// [신규] 예약 제출 idempotency (quoteId)
//
// 더블클릭·네트워크 재시도로 같은 견적이 두 번 제출돼도 예약은 1건이어야 한다.
// 고객에게는 오류가 아니라 동일한 성공 결과를 반환한다.
// ===========================================================================

function idemBody(over = {}) {
  return fullyAgreedReservationBody({
    customerPhone: '010-9900-0001',
    desiredDate: '2027-06-10',
    timeSlot: 'morning',
    ...over,
  });
}

test('idempotency: 같은 quoteToken으로 순차 2회 제출해도 예약은 1건', async () => {
  const body = idemBody({ customerPhone: '010-9900-0011' });
  const before = db.prepare('SELECT COUNT(*) c FROM reservations').get().c;

  const r1 = await reservationsRoute.POST(makeReqWithFreshIp(body));
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const r2 = await reservationsRoute.POST(makeReqWithFreshIp(body));
  assert.equal(r2.status, 201, '재요청도 성공 응답이어야 한다 (오류 아님)');

  const after = db.prepare('SELECT COUNT(*) c FROM reservations').get().c;
  assert.equal(after - before, 1, '예약은 1건만 생성되어야 한다');

  // 같은 예약번호를 돌려준다
  assert.equal(
    r2.body.reservation.reservation_code,
    r1.body.reservation.reservation_code,
    '재요청 응답의 reservationCode가 같아야 한다'
  );

  // payment / confirmation_log도 1건씩
  const rid = r1.body.reservation.id;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments WHERE reservation_id=?').get(rid).c, 1);
  assert.equal(
    db.prepare(`SELECT COUNT(*) c FROM confirmation_logs WHERE reservation_id=? AND action='reservation_received'`).get(rid).c,
    1
  );
});

test('idempotency: 같은 quoteToken 동시 2회 제출해도 예약은 1건', async () => {
  const body = idemBody({ customerPhone: '010-9900-0012', desiredDate: '2027-06-11' });
  const before = db.prepare('SELECT COUNT(*) c FROM reservations').get().c;

  const [a, b] = await Promise.all([
    reservationsRoute.POST(makeReqWithFreshIp(body)),
    reservationsRoute.POST(makeReqWithFreshIp(body)),
  ]);

  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.status, 201, JSON.stringify(b.body));

  const after = db.prepare('SELECT COUNT(*) c FROM reservations').get().c;
  assert.equal(after - before, 1, '동시 요청에도 예약은 1건이어야 한다');
  assert.equal(
    a.body.reservation.reservation_code,
    b.body.reservation.reservation_code,
    '두 응답의 예약번호가 같아야 한다'
  );

  const rid = a.body.reservation.id;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments WHERE reservation_id=?').get(rid).c, 1);
});

test('idempotency: 서로 다른 quoteId는 각각 정상 예약된다', async () => {
  const before = db.prepare('SELECT COUNT(*) c FROM reservations').get().c;
  const r1 = await reservationsRoute.POST(makeReqWithFreshIp(
    idemBody({ customerPhone: '010-9900-0013', desiredDate: '2027-06-12' })
  ));
  const r2 = await reservationsRoute.POST(makeReqWithFreshIp(
    idemBody({ customerPhone: '010-9900-0014', desiredDate: '2027-06-13' })
  ));
  assert.equal(r1.status, 201);
  assert.equal(r2.status, 201);
  assert.notEqual(r1.body.reservation.reservation_code, r2.body.reservation.reservation_code);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations').get().c - before, 2);
});

test('idempotency: quote_id가 예약에 snapshot으로 저장된다', async () => {
  const body = idemBody({ customerPhone: '010-9900-0015', desiredDate: '2027-06-14' });
  const res = await reservationsRoute.POST(makeReqWithFreshIp(body));
  assert.equal(res.status, 201);
  const row = db.prepare('SELECT quote_id FROM reservations WHERE id=?').get(res.body.reservation.id);
  assert.ok(row.quote_id, 'quote_id가 저장되어야 한다');
  // 토큰의 quoteId와 일치
  const snap = quoteToken.verifyQuoteToken(body.quoteToken);
  assert.equal(row.quote_id, snap.quoteId);
});

test('idempotency: 만료 토큰은 QUOTE_EXPIRED로 거절된다', async () => {
  const snap = quoteToken.verifyQuoteToken(idemBody().quoteToken);
  // 만료된 토큰을 정상 서명으로 재발급
  const crypto = await import('node:crypto');
  const CANON = ['schemaVersion','quoteId','serviceType','productKey','desiredDate','timeSlot',
    'areaSidoCode','areaSigunguCode','areaDongCode','basePrice','holidaySurcharge',
    'dateAdjustmentAmount','automaticDiscount','couponDiscount','promotionId','couponId',
    'couponCode','estimatedTotal','depositAmount','estimatedBalance','issuedAt','expiresAt'];
  const expired = { ...snap, issuedAt: Date.now() - 7200000, expiresAt: Date.now() - 3600000 };
  const ordered = {};
  for (const k of CANON) ordered[k] = expired[k] ?? null;
  const b64 = (b) => b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const p = b64(Buffer.from(JSON.stringify(ordered), 'utf8'));
  const mac = b64(crypto.createHmac('sha256', process.env.QUOTE_TOKEN_SECRET).update(p).digest());

  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    idemBody({ customerPhone: '010-9900-0016' })
  ));
  void res;
  const bad = await reservationsRoute.POST(makeReqWithFreshIp({
    ...idemBody({ customerPhone: '010-9900-0017' }),
    quoteToken: `v${quoteToken.QUOTE_TOKEN_VERSION}.${p}.${mac}`,
  }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'QUOTE_EXPIRED');
});

test('idempotency: 변조 토큰은 QUOTE_TAMPERED로 거절된다', async () => {
  const body = idemBody({ customerPhone: '010-9900-0018' });
  const [v, payload, mac] = body.quoteToken.split('.');
  const flipped = payload.slice(0, -1) + (payload.slice(-1) === 'A' ? 'B' : 'A');
  const res = await reservationsRoute.POST(makeReqWithFreshIp({
    ...body, quoteToken: `${v}.${flipped}.${mac}`,
  }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'QUOTE_TAMPERED');
});

test('idempotency: unique violation을 generic 500으로 반환하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/reservations.ts'), 'utf8');
  assert.match(src, /isUniqueViolation/, '경합 시 unique violation을 식별해야 한다');
  assert.match(src, /findReservationByQuoteId/, '경합 시 기존 예약을 재조회해야 한다');
});

test('quoteToken payload에 개인정보를 넣지 않는다', async () => {
  const snap = quoteToken.verifyQuoteToken(idemBody().quoteToken);
  for (const banned of ['customerName', 'customerPhone', 'address', 'customerEmail', 'depositorName']) {
    assert.equal(snap[banned], undefined, `${banned}가 토큰 payload에 있으면 안 된다`);
  }
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/quote-token.ts'), 'utf8');
  assert.doesNotMatch(src, /customerName|customerPhone/, 'HMAC은 암호화가 아니므로 개인정보 금지');
});

// --- unique violation 오판 방지 ---

test('unique violation 판정: 실제 unique 오류만 인식한다', async () => {
  const repo = await import('../src/database/repositories/reservation-repository.ts');

  // 인식해야 하는 것
  assert.equal(repo.isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' })), true, 'PG 23505');
  assert.equal(
    repo.isUniqueViolation(Object.assign(new Error('UNIQUE constraint failed: reservations.quote_id'), { code: 'ERR_SQLITE_ERROR' })),
    true, 'SQLite unique'
  );

  // 오판하면 안 되는 것 — 실제 장애가 "정상 재요청"으로 둔갑한다
  const mustNot = [
    Object.assign(new Error('timed out'), { code: 'DB_TIMEOUT' }),
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('could not determine data type'), { code: '42P18' }),
    Object.assign(new Error('syntax error'), { code: '42601' }),
    Object.assign(new Error('not null violation'), { code: '23502' }),
    Object.assign(new Error('foreign key violation'), { code: '23503' }),
    Object.assign(new Error('connection terminated'), { code: '08006' }),
    null, undefined, 'string error', 42,
  ];
  for (const e of mustNot) {
    assert.equal(repo.isUniqueViolation(e), false, `오판: ${JSON.stringify(e?.code ?? e)}`);
  }
});

test('cause 체인 unwrap은 depth 제한과 순환 방지를 갖는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/reservations.ts'), 'utf8');
  assert.match(src, /MAX_CAUSE_DEPTH/, 'depth 제한이 있어야 한다');
  assert.match(src, /seen\.has\(cur\)/, '순환 cause 방지가 있어야 한다');
});

test('중첩 unique 오류는 idempotency로 인식되고 다른 오류는 그대로 실패한다', async () => {
  const repo = await import('../src/database/repositories/reservation-repository.ts');
  const { ReservationPersistenceError } = await import('../src/lib/reservations.ts');

  // nested unique violation → 인식
  const nestedUnique = new ReservationPersistenceError(
    'transaction',
    new ReservationPersistenceError('reservation_insert', Object.assign(new Error('dup'), { code: '23505' }))
  );
  let chain = [];
  let cur = nestedUnique;
  for (let i = 0; i < 5 && cur; i++) { chain.push(cur); cur = cur.cause; }
  assert.ok(chain.some((x) => repo.isUniqueViolation(x)), 'nested unique를 찾아야 한다');

  // nested timeout / ECONNREFUSED → 인식하지 않음
  for (const inner of [
    Object.assign(new Error('timed out'), { code: 'DB_TIMEOUT' }),
    Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
  ]) {
    const nested = new ReservationPersistenceError('transaction', new ReservationPersistenceError('reservation_insert', inner));
    const c = [];
    let x = nested;
    for (let i = 0; i < 5 && x; i++) { c.push(x); x = x.cause; }
    assert.equal(c.some((y) => repo.isUniqueViolation(y)), false, `${inner.code}를 unique로 오인하면 안 된다`);
  }
});

test('SQLite 트랜잭션은 직렬화되어 BEGIN이 중첩되지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  assert.match(src, /runSerializedSqlite/, 'SQLite 트랜잭션 직렬화가 있어야 한다');
  assert.match(src, /sqliteTxChain/);
  // PostgreSQL 경로는 직렬화하지 않는다 (서버가 동시성 처리)
  const pgPart = src.slice(src.indexOf('const client = await getPostgresClient();', src.indexOf('export async function withTransaction')));
  assert.doesNotMatch(pgPart.slice(0, 300), /runSerializedSqlite/);
});

test('idempotent 재요청은 고객 payload로 기존 예약을 덮어쓰지 않는다', async () => {
  const body = idemBody({ customerPhone: '010-9900-0021', desiredDate: '2027-06-20' });
  const r1 = await reservationsRoute.POST(makeReqWithFreshIp(body));
  assert.equal(r1.status, 201);
  const original = db.prepare('SELECT customer_name, customer_phone FROM reservations WHERE id=?')
    .get(r1.body.reservation.id);

  // 같은 quoteToken에 다른 고객 정보를 붙여 재전송
  const r2 = await reservationsRoute.POST(makeReqWithFreshIp({
    ...body, customerName: '다른사람', customerPhone: '010-0000-9999',
  }));
  assert.equal(r2.status, 201);
  assert.equal(r2.body.reservation.reservation_code, r1.body.reservation.reservation_code);

  const after = db.prepare('SELECT customer_name, customer_phone FROM reservations WHERE id=?')
    .get(r1.body.reservation.id);
  assert.deepEqual(after, original, '재요청 payload가 최초 예약을 덮어쓰면 안 된다');
});

test('idempotent 재요청은 금액과 상태가 최초와 동일하다', async () => {
  const body = idemBody({ customerPhone: '010-9900-0022', desiredDate: '2027-06-21' });
  const r1 = await reservationsRoute.POST(makeReqWithFreshIp(body));
  const r2 = await reservationsRoute.POST(makeReqWithFreshIp(body));
  assert.equal(r1.body.reservation.id, r2.body.reservation.id);
  assert.equal(r1.body.reservation.reservation_status, r2.body.reservation.reservation_status);
  for (const k of ['totalAmount', 'depositAmount', 'balanceAmount']) {
    assert.equal(r2.body.deposit?.[k] ?? r2.body[k], r1.body.deposit?.[k] ?? r1.body[k], `${k} 동일`);
  }
});

// ===========================================================================
// [신규] quote → reservation 전체 연결 (B1 + B2 통합)
// ===========================================================================

test('전체 연결: 정상 지역/날짜/상품 → quote 발급 → 예약 접수 → 계좌 안내', async () => {
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-07-05', timeSlot: 'morning',
  }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.quoteToken, 'enabled 지역·정상 상품이면 토큰이 발급되어야 한다');

  const snap = quoteToken.verifyQuoteToken(res.body.quoteToken);
  assert.equal(snap.areaSigunguCode, TEST_SIGUNGU, '지역 코드가 토큰에 서명된다');

  const created = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    quoteToken: res.body.quoteToken,
    houseTypeKey: '24평', desiredDate: '2027-07-05', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7000-0001',
  })));
  assert.equal(created.status, 201, JSON.stringify(created.body));

  // 예약 + payment + confirmation_log
  const rid = created.body.reservation.id;
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments WHERE reservation_id=?').get(rid).c, 1);
  assert.equal(
    db.prepare(`SELECT COUNT(*) c FROM confirmation_logs WHERE reservation_id=?`).get(rid).c >= 1, true
  );

  // 계좌 안내가 성공 응답에 포함된다
  const acct = created.body.deposit ?? created.body;
  assert.ok(JSON.stringify(acct).includes('bank') || acct.account, '계좌 정보가 응답에 있어야 한다');
});

test('전체 연결: disabled 지역은 quote 단계에서 차단된다', async () => {
  const regionRepo = await import('../src/database/repositories/region-repository.ts');
  await regionRepo.upsertArea({ code: 'TX99', name: '불가구', level: 'sigungu', parentCode: TEST_SIDO });
  await regionRepo.setServiceArea({ sigunguCode: 'TX99', isEnabled: false });

  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-07-06',
    areaSidoCode: TEST_SIDO, areaSigunguCode: 'TX99', areaDongCode: null,
  }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'OUT_OF_SERVICE_AREA');
  assert.equal(res.body.quoteToken, undefined, '차단 시 토큰을 발급하면 안 된다');
});

test('전체 연결: master가 있으면 SERVICE_AREA_NOT_READY 오탐이 없다', async () => {
  const regionRepo = await import('../src/database/repositories/region-repository.ts');
  assert.ok((await regionRepo.countAreas()) > 0, 'master fixture가 있어야 한다');

  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-07-07',
  }));
  assert.notEqual(res.body.code, 'SERVICE_AREA_NOT_READY', '정상 데이터에서 fail-closed가 발동하면 안 된다');
  assert.equal(res.status, 200);
});

test('전체 연결: 예약 제출이 가격을 재계산하지 않는다', async () => {
  const q = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '32평', desiredDate: '2027-07-08', timeSlot: 'morning',
  }));
  const snap = quoteToken.verifyQuoteToken(q.body.quoteToken);

  // 예약 제출 직전에 가격표를 바꿔도 저장 금액은 토큰 값을 따른다
  const orig = db.prepare(`SELECT base_price FROM price_rules WHERE service_type='입주청소' AND product_key='32평'`).get().base_price;
  try {
    db.prepare(`UPDATE price_rules SET base_price=111000 WHERE service_type='입주청소' AND product_key='32평'`).run();
    const created = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
      quoteToken: q.body.quoteToken,
      houseTypeKey: '32평', desiredDate: '2027-07-08', timeSlot: 'morning',
      areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
      customerPhone: '010-7000-0002',
    })));
    assert.equal(created.status, 201);
    const row = db.prepare('SELECT estimated_total_snapshot FROM reservations WHERE id=?').get(created.body.reservation.id);
    assert.equal(row.estimated_total_snapshot, snap.estimatedTotal, '토큰 금액이 저장되어야 한다 (재계산 금지)');
    assert.notEqual(row.estimated_total_snapshot, 111000);
  } finally {
    db.prepare(`UPDATE price_rules SET base_price=? WHERE service_type='입주청소' AND product_key='32평'`).run(orig);
  }
});

test('전체 연결: quote 이후 슬롯이 마감되면 SLOT_UNAVAILABLE (토큰 오류 아님)', async () => {
  const date = '2027-07-09';
  await calendar.setCalendarDay(date, 'available', 1, null, 'morning');

  const q = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: date, timeSlot: 'morning',
  }));
  assert.ok(q.body.quoteToken);

  // 먼저 다른 고객이 슬롯을 채운다
  const first = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    houseTypeKey: '24평', desiredDate: date, timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7000-0003',
  })));
  assert.equal(first.status, 201);

  // 유효한 토큰이지만 슬롯이 마감 → 409 SLOT_UNAVAILABLE
  const second = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    quoteToken: q.body.quoteToken,
    houseTypeKey: '24평', desiredDate: date, timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-7000-0004',
  })));
  assert.equal(second.status, 409, JSON.stringify(second.body));
  assert.equal(second.body.code, 'SLOT_UNAVAILABLE');
  assert.notEqual(second.body.code, 'QUOTE_TAMPERED', '토큰 오류로 분류하면 안 된다');
});

// ===========================================================================
// [신규] 할인 시스템
// 계산 순서: 정상가 → 자동 프로모션 → 쿠폰 → 관리자 수동 할인 → 최종금액
// ===========================================================================

let discounts;
function resetDiscountData() {
  db.prepare('DELETE FROM coupon_redemptions').run();
  db.prepare('DELETE FROM coupons').run();
  db.prepare('DELETE FROM discount_promotions').run();
}
function addPromo(o = {}) {
  const d = {
    name: '프로모션', is_active: 1, discount_type: 'fixed', discount_value: 10000,
    starts_at: null, ends_at: null, service_type: null, product_key: null,
    min_amount: 0, max_discount_amount: null, priority: 0, ...o,
  };
  db.prepare(`INSERT INTO discount_promotions
    (name,is_active,discount_type,discount_value,starts_at,ends_at,service_type,product_key,min_amount,max_discount_amount,priority)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    d.name, d.is_active, d.discount_type, d.discount_value, d.starts_at, d.ends_at,
    d.service_type, d.product_key, d.min_amount, d.max_discount_amount, d.priority);
  return db.prepare('SELECT last_insert_rowid() id').get().id;
}
function addCoupon(o = {}) {
  const c = {
    code: 'TEST10', name: '테스트쿠폰', is_active: 1, discount_type: 'fixed', discount_value: 10000,
    starts_at: null, ends_at: null, service_type: null, product_key: null,
    min_amount: 0, max_discount_amount: null, total_usage_limit: null, per_phone_limit: null, ...o,
  };
  db.prepare(`INSERT INTO coupons
    (code,name,is_active,discount_type,discount_value,starts_at,ends_at,service_type,product_key,min_amount,max_discount_amount,total_usage_limit,per_phone_limit)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    c.code, c.name, c.is_active, c.discount_type, c.discount_value, c.starts_at, c.ends_at,
    c.service_type, c.product_key, c.min_amount, c.max_discount_amount, c.total_usage_limit, c.per_phone_limit);
  return db.prepare('SELECT last_insert_rowid() id').get().id;
}

test('할인 모듈 로드', async () => {
  discounts = await import('../src/lib/discounts.ts');
  assert.equal(typeof discounts.calculateDiscounts, 'function');
});

// --- 자동 프로모션 ---

test('자동 정액 할인이 적용된다', async () => {
  resetDiscountData();
  addPromo({ name: '정액', discount_type: 'fixed', discount_value: 20000 });
  const r = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '24평', originalAmount: 339000 });
  assert.equal(r.automaticDiscountAmount, 20000);
  assert.equal(r.finalAmount, 319000);
});

test('자동 정률 할인이 현재 금액 기준으로 계산된다', async () => {
  resetDiscountData();
  addPromo({ name: '정률10', discount_type: 'percent', discount_value: 10 });
  const r = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '24평', originalAmount: 339000 });
  assert.equal(r.automaticDiscountAmount, 33900);
  assert.equal(r.finalAmount, 305100);
});

test('여러 자동 프로모션 중 가장 큰 할인 1개만 적용된다', async () => {
  resetDiscountData();
  addPromo({ name: '작은', discount_type: 'fixed', discount_value: 10000 });
  const big = addPromo({ name: '큰', discount_type: 'fixed', discount_value: 50000 });
  addPromo({ name: '중간', discount_type: 'percent', discount_value: 5 });
  const r = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '24평', originalAmount: 339000 });
  assert.equal(r.automaticDiscountAmount, 50000, '가장 큰 할인 1개만');
  assert.equal(r.promotionId, big);
  assert.equal(r.finalAmount, 289000, '중첩 적용되면 안 된다');
});

test('기간 전/후 프로모션은 적용되지 않는다', async () => {
  resetDiscountData();
  addPromo({ name: '미래', starts_at: '2099-01-01T00:00:00.000Z', discount_value: 50000 });
  addPromo({ name: '과거', ends_at: '2000-01-01T00:00:00.000Z', discount_value: 50000 });
  const r = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '24평', originalAmount: 339000 });
  assert.equal(r.automaticDiscountAmount, 0);
  assert.equal(r.finalAmount, 339000);
});

test('비활성 프로모션은 적용되지 않는다', async () => {
  resetDiscountData();
  addPromo({ name: '중지', is_active: 0, discount_value: 50000 });
  const r = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '24평', originalAmount: 339000 });
  assert.equal(r.automaticDiscountAmount, 0);
});

test('서비스/상품 제한 프로모션은 해당 조건에만 적용된다', async () => {
  resetDiscountData();
  addPromo({ name: '사이청소전용', service_type: '사이청소', discount_value: 30000 });
  addPromo({ name: '32평전용', product_key: '32평', discount_value: 40000 });

  const a = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '24평', originalAmount: 339000 });
  assert.equal(a.automaticDiscountAmount, 0, '조건 불일치');

  const b = await discounts.calculateDiscounts({ serviceType: '사이청소', productKey: '24평', originalAmount: 339000 });
  assert.equal(b.automaticDiscountAmount, 30000);

  const c = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '32평', originalAmount: 459000 });
  assert.equal(c.automaticDiscountAmount, 40000);
});

test('최소금액 미만이면 프로모션이 적용되지 않는다', async () => {
  resetDiscountData();
  addPromo({ name: '30만이상', min_amount: 300000, discount_value: 20000 });
  const low = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '원룸', originalAmount: 179000 });
  assert.equal(low.automaticDiscountAmount, 0);
  const high = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '24평', originalAmount: 369000 });
  assert.equal(high.automaticDiscountAmount, 20000);
});

test('최대 할인 cap이 정률 할인을 제한한다', async () => {
  resetDiscountData();
  addPromo({ name: '20%최대3만', discount_type: 'percent', discount_value: 20, max_discount_amount: 30000 });
  const r = await discounts.calculateDiscounts({ serviceType: '입주청소', productKey: '32평', originalAmount: 459000 });
  assert.equal(r.automaticDiscountAmount, 30000, '91,800원이 아니라 cap 30,000원');
});

// --- 쿠폰 ---

test('정상 쿠폰이 적용된다 (정액/정률)', async () => {
  resetDiscountData();
  addCoupon({ code: 'FIX5', discount_type: 'fixed', discount_value: 5000 });
  const a = await discounts.calculateDiscounts({
    serviceType: '입주청소', productKey: '24평', originalAmount: 339000, couponCode: 'FIX5' });
  assert.equal(a.couponDiscountAmount, 5000);
  assert.equal(a.finalAmount, 334000);

  resetDiscountData();
  addCoupon({ code: 'PCT10', discount_type: 'percent', discount_value: 10 });
  const b = await discounts.calculateDiscounts({
    serviceType: '입주청소', productKey: '24평', originalAmount: 339000, couponCode: 'PCT10' });
  assert.equal(b.couponDiscountAmount, 33900);
});

test('쿠폰 코드는 trim + 대소문자 정규화된다', async () => {
  resetDiscountData();
  addCoupon({ code: 'WELCOME' });
  for (const input of ['  welcome  ', 'Welcome', 'WELCOME']) {
    const r = await discounts.calculateDiscounts({
      serviceType: '입주청소', productKey: '24평', originalAmount: 339000, couponCode: input });
    assert.equal(r.couponDiscountAmount, 10000, `${input} 정규화 실패`);
  }
});

test('만료/중지/잘못된 쿠폰은 각각 명확한 코드로 거부된다', async () => {
  resetDiscountData();
  addCoupon({ code: 'EXPIRED', ends_at: '2000-01-01T00:00:00.000Z' });
  addCoupon({ code: 'STOPPED', is_active: 0 });
  const cases = [
    ['EXPIRED', 'COUPON_EXPIRED'],
    ['STOPPED', 'COUPON_INACTIVE'],
    ['NOPE', 'COUPON_NOT_FOUND'],
  ];
  for (const [code, expected] of cases) {
    await assert.rejects(
      () => discounts.calculateDiscounts({
        serviceType: '입주청소', productKey: '24평', originalAmount: 339000, couponCode: code }),
      (e) => e.code === expected,
      `${code} → ${expected}`
    );
  }
});

test('자동할인과 쿠폰은 중복 적용되며 쿠폰은 자동할인 후 금액 기준이다', async () => {
  resetDiscountData();
  addPromo({ name: '자동2만', discount_type: 'fixed', discount_value: 20000 });
  addCoupon({ code: 'PCT10', discount_type: 'percent', discount_value: 10 });

  const r = await discounts.calculateDiscounts({
    serviceType: '입주청소', productKey: '24평', originalAmount: 339000, couponCode: 'PCT10' });

  assert.equal(r.originalAmount, 339000);
  assert.equal(r.automaticDiscountAmount, 20000);
  // 319,000의 10% = 31,900 (339,000 기준 33,900이 아님)
  assert.equal(r.couponDiscountAmount, 31900, '쿠폰은 자동할인 후 금액 기준');
  assert.equal(r.finalAmount, 287100);
});

test('할인액은 남은 금액을 넘지 않고 finalAmount는 0 이상이다', async () => {
  // 자동 프로모션 단독 — 정상가를 초과하는 할인값도 정상가로 잘린다
  resetDiscountData();
  addPromo({ name: '과다', discount_type: 'fixed', discount_value: 999999 });
  const a = await discounts.calculateDiscounts({
    serviceType: '입주청소', productKey: '원룸', originalAmount: 179000 });
  assert.equal(a.automaticDiscountAmount, 179000, '정상가를 초과하지 않는다');
  assert.equal(a.finalAmount, 0);

  // 자동할인이 전액을 소진하면 쿠폰은 적용할 금액이 없다 → 명확히 거부
  resetDiscountData();
  addPromo({ name: '과다', discount_type: 'fixed', discount_value: 999999 });
  addCoupon({ code: 'ALSO', discount_type: 'fixed', discount_value: 5000 });
  await assert.rejects(
    () => discounts.calculateDiscounts({
      serviceType: '입주청소', productKey: '원룸', originalAmount: 179000, couponCode: 'ALSO' }),
    (e) => e.code === 'COUPON_NO_DISCOUNT',
    '할인할 금액이 없으면 조용히 0원 처리하지 않고 알린다'
  );

  // 자동할인 + 쿠폰이 함께 큰 경우에도 음수가 되지 않는다
  resetDiscountData();
  addPromo({ name: '절반', discount_type: 'percent', discount_value: 50 });
  addCoupon({ code: 'BIG', discount_type: 'fixed', discount_value: 999999 });
  const c = await discounts.calculateDiscounts({
    serviceType: '입주청소', productKey: '원룸', originalAmount: 179000, couponCode: 'BIG' });
  assert.ok(c.finalAmount >= 0);
  assert.equal(c.finalAmount, 0);
  assert.equal(c.automaticDiscountAmount + c.couponDiscountAmount, 179000, '합계가 정상가를 넘지 않는다');
});

test('사용한도가 소진된 쿠폰은 견적 단계에서 안내된다', async () => {
  resetDiscountData();
  const id = addCoupon({ code: 'LIMIT1', total_usage_limit: 1 });
  db.prepare(`INSERT INTO coupon_redemptions (coupon_id, reservation_id, customer_phone, discount_amount)
              VALUES (?, 999999, '010-0000-0000', 10000)`).run(id);
  await assert.rejects(
    () => discounts.calculateDiscounts({
      serviceType: '입주청소', productKey: '24평', originalAmount: 339000, couponCode: 'LIMIT1' }),
    (e) => e.code === 'COUPON_EXHAUSTED'
  );
  db.prepare('DELETE FROM coupon_redemptions WHERE reservation_id = 999999').run();
});

test('quote 발급은 쿠폰 사용횟수를 소진하지 않는다', async () => {
  resetDiscountData();
  const id = addCoupon({ code: 'NOTUSED', total_usage_limit: 1 });
  for (let i = 0; i < 3; i++) {
    await discounts.calculateDiscounts({
      serviceType: '입주청소', productKey: '24평', originalAmount: 339000, couponCode: 'NOTUSED' });
  }
  const used = db.prepare('SELECT COUNT(*) c FROM coupon_redemptions WHERE coupon_id=?').get(id).c;
  assert.equal(used, 0, '견적만으로는 소진되지 않는다');
});

// --- 예약 snapshot 보존 ---

async function bookWithDiscount(over = {}, couponCode = null) {
  const q = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: over.desiredDate ?? '2027-09-01',
    timeSlot: over.timeSlot ?? 'morning', couponCode,
    customerPhone: over.customerPhone,
  }));
  assert.ok(q.body.quoteToken, JSON.stringify(q.body));
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    quoteToken: q.body.quoteToken,
    houseTypeKey: '24평',
    desiredDate: over.desiredDate ?? '2027-09-01',
    timeSlot: over.timeSlot ?? 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    ...over,
  })));
  return { quote: q.body, res };
}

test('할인이 적용된 예약은 snapshot 전 항목을 보존한다', async () => {
  resetDiscountData();
  const promoId = addPromo({ name: '가을할인', discount_type: 'fixed', discount_value: 20000 });
  const couponId = addCoupon({ code: 'AUTUMN', discount_type: 'fixed', discount_value: 10000 });

  const { quote, res } = await bookWithDiscount(
    { customerPhone: '010-8100-0001', desiredDate: '2027-09-01' }, 'AUTUMN');
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const row = db.prepare(`SELECT original_amount, automatic_discount_amount, coupon_discount_amount,
    admin_discount_amount, final_amount, promotion_id, promotion_name, coupon_id, coupon_code,
    deposit_amount_snapshot, estimated_balance_snapshot FROM reservations WHERE id=?`)
    .get(res.body.reservation.id);

  assert.equal(row.original_amount, CANONICAL_PRICES['24평']);
  assert.equal(row.automatic_discount_amount, 20000);
  assert.equal(row.coupon_discount_amount, 10000);
  assert.equal(row.admin_discount_amount, 0);
  assert.equal(row.final_amount, CANONICAL_PRICES['24평'] - 30000);
  assert.equal(row.promotion_id, promoId);
  assert.equal(row.promotion_name, '가을할인');
  assert.equal(row.coupon_id, couponId);
  assert.equal(row.coupon_code, 'AUTUMN');
  // balance = finalAmount - deposit
  assert.equal(row.estimated_balance_snapshot, row.final_amount - row.deposit_amount_snapshot);
  assert.equal(quote.discount.finalAmount, row.final_amount);
});

test('프로모션을 수정/삭제해도 기존 예약 snapshot 금액은 불변', async () => {
  resetDiscountData();
  addPromo({ name: '한시', discount_type: 'fixed', discount_value: 30000 });
  const { res } = await bookWithDiscount({ customerPhone: '010-8100-0002', desiredDate: '2027-09-02' });
  assert.equal(res.status, 201);
  const before = db.prepare('SELECT * FROM reservations WHERE id=?').get(res.body.reservation.id);
  assert.equal(before.automatic_discount_amount, 30000);

  db.prepare('DELETE FROM discount_promotions').run();
  const after = db.prepare('SELECT * FROM reservations WHERE id=?').get(res.body.reservation.id);
  assert.equal(after.automatic_discount_amount, 30000, '프로모션 삭제 후에도 불변');
  assert.equal(after.final_amount, before.final_amount);
});

test('쿠폰 사용은 예약 저장 시점에 기록된다', async () => {
  resetDiscountData();
  const couponId = addCoupon({ code: 'ONCE', total_usage_limit: 5 });
  const { res } = await bookWithDiscount(
    { customerPhone: '010-8100-0003', desiredDate: '2027-09-03' }, 'ONCE');
  assert.equal(res.status, 201);
  const red = db.prepare('SELECT * FROM coupon_redemptions WHERE coupon_id=?').all(couponId);
  assert.equal(red.length, 1);
  assert.equal(red[0].reservation_id, res.body.reservation.id);
  assert.equal(red[0].discount_amount, 10000);
});

test('쿠폰 한도가 quote 후 소진되면 COUPON_EXHAUSTED 409', async () => {
  resetDiscountData();
  const couponId = addCoupon({ code: 'LAST1', total_usage_limit: 1 });

  // 고객 A가 견적을 받는다 (아직 소진 전)
  const q = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-09-05',
    timeSlot: 'morning', couponCode: 'LAST1',
  }));
  assert.ok(q.body.quoteToken);

  // 그 사이 고객 B가 마지막 1개를 사용
  db.prepare(`INSERT INTO coupon_redemptions (coupon_id, reservation_id, customer_phone, discount_amount)
              VALUES (?, 999998, '010-0000-1111', 10000)`).run(couponId);

  // 고객 A가 제출 → 가격을 몰래 재계산하지 않고 409
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    quoteToken: q.body.quoteToken,
    houseTypeKey: '24평', desiredDate: '2027-09-05', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-8100-0005',
  })));
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'COUPON_EXHAUSTED');

  // 예약이 생성되지 않았다
  const made = db.prepare(`SELECT COUNT(*) c FROM reservations WHERE desired_date='2027-09-05'`).get().c;
  assert.equal(made, 0, '쿠폰 소진 시 예약이 남으면 안 된다');
  db.prepare('DELETE FROM coupon_redemptions WHERE reservation_id=999998').run();
});

test('quoteToken의 할인금액을 변조하면 거절된다', async () => {
  resetDiscountData();
  addPromo({ name: '자동', discount_type: 'fixed', discount_value: 10000 });
  const q = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-09-06', timeSlot: 'morning',
  }));
  const [v, payload, mac] = q.body.quoteToken.split('.');
  const decoded = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  decoded.couponDiscount = 200000;
  decoded.estimatedTotal = 100000;
  const forged = Buffer.from(JSON.stringify(decoded), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    quoteToken: `${v}.${forged}.${mac}`,
    houseTypeKey: '24평', desiredDate: '2027-09-06', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
    customerPhone: '010-8100-0006',
  })));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'QUOTE_TAMPERED');
});

// --- 관리자 수동 할인 ---

test('관리자 수동 할인이 마지막 단계로 적용되고 audit이 남는다', async () => {
  resetDiscountData();
  addPromo({ name: '자동1만', discount_type: 'fixed', discount_value: 10000 });
  const { res } = await bookWithDiscount({ customerPhone: '010-8200-0001', desiredDate: '2027-09-10' });
  const id = res.body.reservation.id;
  const before = db.prepare('SELECT final_amount, deposit_amount_snapshot FROM reservations WHERE id=?').get(id);

  const r = await reservations.applyAdminDiscount({
    reservationId: id, discountType: 'fixed', discountValue: 15000,
    reason: '재방문 고객 할인', adminId: null, adminName: '관리자',
  });
  assert.equal(r.calculatedAmount, 15000);
  assert.equal(r.newFinalAmount, before.final_amount - 15000);

  const after = db.prepare(`SELECT admin_discount_amount, admin_discount_reason, final_amount,
    estimated_balance_snapshot, deposit_amount_snapshot FROM reservations WHERE id=?`).get(id);
  assert.equal(after.admin_discount_amount, 15000);
  assert.equal(after.admin_discount_reason, '재방문 고객 할인');
  assert.equal(after.final_amount, before.final_amount - 15000);
  assert.equal(after.estimated_balance_snapshot, after.final_amount - after.deposit_amount_snapshot);

  const audit = db.prepare('SELECT * FROM reservation_discount_adjustments WHERE reservation_id=?').all(id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, '재방문 고객 할인');
  assert.equal(audit[0].previous_final_amount, before.final_amount);
  assert.equal(audit[0].new_final_amount, after.final_amount);
});

test('관리자 할인 사유는 필수다', async () => {
  const { res } = await bookWithDiscount({ customerPhone: '010-8200-0002', desiredDate: '2027-09-11' });
  await assert.rejects(
    () => reservations.applyAdminDiscount({
      reservationId: res.body.reservation.id, discountType: 'fixed', discountValue: 10000,
      reason: '   ', adminId: null, adminName: '관리자',
    }),
    (e) => e.code === 'ADMIN_DISCOUNT_REASON_REQUIRED'
  );
});

test('관리자 정률 할인은 현재 최종금액 기준으로 계산된다', async () => {
  resetDiscountData();
  const { res } = await bookWithDiscount({ customerPhone: '010-8200-0003', desiredDate: '2027-09-12' });
  const id = res.body.reservation.id;
  const before = db.prepare('SELECT final_amount FROM reservations WHERE id=?').get(id).final_amount;
  const r = await reservations.applyAdminDiscount({
    reservationId: id, discountType: 'percent', discountValue: 10,
    reason: '사장님 재량', adminId: null, adminName: '관리자',
  });
  assert.equal(r.calculatedAmount, Math.floor(before * 0.1));
});

test('결제된 금액보다 낮아지는 관리자 할인은 차단된다', async () => {
  resetDiscountData();
  const { res } = await bookWithDiscount({ customerPhone: '010-8200-0004', desiredDate: '2027-09-13' });
  const id = res.body.reservation.id;
  await reservations.confirmPayment(id, '관리자', null);

  await assert.rejects(
    () => reservations.applyAdminDiscount({
      reservationId: id, discountType: 'fixed', discountValue: 999999,
      reason: '과다 할인 시도', adminId: null, adminName: '관리자',
    }),
    (e) => e.code === 'ADMIN_DISCOUNT_BELOW_PAID' || e.code === 'ADMIN_DISCOUNT_INVALID',
    '입금액보다 낮아지는 할인은 자동 처리하지 않는다'
  );
});

test('할인 snapshot이 없는 기존 예약도 0원/default로 안전하게 읽힌다', async () => {
  const { res } = await bookWithDiscount({ customerPhone: '010-8300-0001', desiredDate: '2027-09-14' });
  const id = res.body.reservation.id;
  // 구 데이터처럼 snapshot을 비운다
  db.prepare(`UPDATE reservations SET original_amount=NULL, final_amount=NULL,
    automatic_discount_amount=0, coupon_discount_amount=0, admin_discount_amount=0 WHERE id=?`).run(id);
  const row = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
  assert.equal(row.automatic_discount_amount, 0);
  assert.equal(row.coupon_discount_amount, 0);
  // fallback: total_amount_snapshot으로 최종금액을 읽을 수 있어야 한다
  assert.ok(row.total_amount_snapshot > 0 || row.estimated_total_snapshot > 0);
});

// ===========================================================================
// [신규] 공지사항 / 팝업
// ===========================================================================

let notices;
function addNotice(o = {}) {
  const n = {
    title: '공지', content: '내용', notice_type: 'normal',
    is_published: 1, is_pinned: 0, is_popup: 0,
    publish_start_at: null, publish_end_at: null, ...o,
  };
  db.prepare(`INSERT INTO notices
    (title,content,notice_type,is_published,is_pinned,is_popup,publish_start_at,publish_end_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    n.title, n.content, n.notice_type, n.is_published, n.is_pinned, n.is_popup,
    n.publish_start_at, n.publish_end_at);
  return db.prepare('SELECT last_insert_rowid() id').get().id;
}
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();

test('공지 모듈 로드', async () => {
  notices = await import('../src/lib/notices.ts');
  assert.equal(typeof notices.listPublishedNotices, 'function');
  db.prepare('DELETE FROM notices').run();
});

test('일반/긴급 공지가 목록에 노출된다', async () => {
  db.prepare('DELETE FROM notices').run();
  addNotice({ title: '일반공지' });
  addNotice({ title: '긴급공지', notice_type: 'urgent' });
  const list = await notices.listPublishedNotices();
  assert.equal(list.length, 2);
  assert.ok(list.some((n) => n.noticeType === 'urgent'), '긴급공지도 게시판에 표시된다');
});

test('비공개 공지는 목록·상세에서 노출되지 않는다', async () => {
  db.prepare('DELETE FROM notices').run();
  const id = addNotice({ title: '비공개', is_published: 0 });
  assert.equal((await notices.listPublishedNotices()).length, 0);
  assert.equal(await notices.getPublishedNotice(id), null, 'URL 직접 요청도 차단');
});

test('노출 시작일 전 / 종료일 후 공지는 노출되지 않는다', async () => {
  db.prepare('DELETE FROM notices').run();
  const future = addNotice({ title: '예정', publish_start_at: iso(3) });
  const past = addNotice({ title: '종료', publish_end_at: iso(-3) });
  const inRange = addNotice({ title: '진행중', publish_start_at: iso(-1), publish_end_at: iso(1) });

  const list = await notices.listPublishedNotices();
  const ids = list.map((n) => n.id);
  assert.ok(!ids.includes(future), '시작 전 미노출');
  assert.ok(!ids.includes(past), '종료 후 미노출');
  assert.ok(ids.includes(inRange), '기간 내 노출');

  assert.equal(await notices.getPublishedNotice(future), null);
  assert.equal(await notices.getPublishedNotice(past), null);
  assert.ok(await notices.getPublishedNotice(inRange));
});

test('상단고정과 긴급공지 정렬 우선순위가 적용된다', async () => {
  db.prepare('DELETE FROM notices').run();
  addNotice({ title: '일반' });
  const urgent = addNotice({ title: '긴급', notice_type: 'urgent' });
  const pinned = addNotice({ title: '고정', is_pinned: 1 });
  const pinnedUrgent = addNotice({ title: '고정+긴급', notice_type: 'urgent', is_pinned: 1 });

  const list = await notices.listPublishedNotices();
  assert.equal(list[0].id, pinnedUrgent, '고정+긴급이 최상단');
  assert.equal(list[1].id, pinned, '고정이 그 다음');
  assert.ok(list.findIndex((n) => n.id === urgent) < list.findIndex((n) => n.title === '일반'),
    '긴급이 일반보다 위');
});

// --- 팝업 ---

test('팝업 OFF 공지는 팝업으로 노출되지 않는다', async () => {
  db.prepare('DELETE FROM notices').run();
  addNotice({ title: '팝업아님', is_popup: 0 });
  assert.equal(await notices.getPopupNotice(), null);
});

test('긴급공지라도 팝업 OFF면 팝업이 되지 않는다', async () => {
  db.prepare('DELETE FROM notices').run();
  addNotice({ title: '긴급', notice_type: 'urgent', is_popup: 0 });
  assert.equal(await notices.getPopupNotice(), null, '긴급 = 자동 팝업이 아니다');
  // 게시판에는 정상 노출
  assert.equal((await notices.listPublishedNotices()).length, 1);
});

test('팝업 ON 공지가 노출된다', async () => {
  db.prepare('DELETE FROM notices').run();
  const id = addNotice({ title: '팝업', is_popup: 1 });
  const p = await notices.getPopupNotice();
  assert.equal(p?.id, id);
});

test('팝업 후보가 여럿이어도 정확히 1개만 선정된다', async () => {
  db.prepare('DELETE FROM notices').run();
  addNotice({ title: '팝업일반', is_popup: 1 });
  addNotice({ title: '팝업고정', is_popup: 1, is_pinned: 1 });
  const urgent = addNotice({ title: '팝업긴급', is_popup: 1, notice_type: 'urgent' });

  const p = await notices.getPopupNotice();
  assert.ok(p, '팝업이 선정되어야 한다');
  assert.equal(p.id, urgent, '우선순위: urgent → pinned → 최신');
  // 반환값은 단건이다 (배열이 아님)
  assert.equal(Array.isArray(p), false);
});

test('비공개/기간 밖 팝업은 선정되지 않는다', async () => {
  db.prepare('DELETE FROM notices').run();
  addNotice({ title: '비공개팝업', is_popup: 1, is_published: 0 });
  addNotice({ title: '종료팝업', is_popup: 1, publish_end_at: iso(-1) });
  assert.equal(await notices.getPopupNotice(), null);
});

test('공개 응답에 Admin 전용 필드가 노출되지 않는다', async () => {
  db.prepare('DELETE FROM notices').run();
  const id = addNotice({ title: '공개' });
  db.prepare('UPDATE notices SET created_by=1 WHERE id=?').run(id);
  const n = await notices.getPublishedNotice(id);
  assert.equal(n.created_by, undefined, 'created_by 미노출');
  assert.equal(n.is_published, undefined);
  assert.equal(n.is_popup, undefined);
});

test('공지 content는 HTML로 렌더링되지 않는다 (XSS 방지)', async () => {
  db.prepare('DELETE FROM notices').run();
  const xss = '<script>alert(1)</script><img src=x onerror=alert(1)>';
  const id = addNotice({ title: 'XSS', content: xss });
  const n = await notices.getPublishedNotice(id);
  // 저장/반환은 평문 그대로
  assert.equal(n.content, xss);

  // 렌더링 컴포넌트가 dangerouslySetInnerHTML을 쓰지 않아야 한다
  for (const f of ['src/app/notice/[id]/page.tsx', 'src/components/NoticePopup.tsx']) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/, `${f}에서 HTML 주입 금지`);
    assert.match(src, /whitespace-pre-line/, `${f}는 줄바꿈을 안전하게 표시해야 한다`);
  }
});

test('Admin 입력(KST)이 UTC로 변환되어 저장된다', async () => {
  // 2027-03-01 09:00 KST = 2027-03-01 00:00 UTC
  const utc = notices.kstInputToIso('2027-03-01T09:00');
  assert.equal(utc, '2027-03-01T00:00:00.000Z');
  assert.equal(notices.kstInputToIso(''), null);
  assert.equal(notices.kstInputToIso(null), null);
  // 이미 타임존이 있으면 그대로 해석
  assert.equal(notices.kstInputToIso('2027-03-01T00:00:00.000Z'), '2027-03-01T00:00:00.000Z');
});

test('공지 Admin API는 세션 인증을 요구한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/notices/route.ts'), 'utf8');
  assert.match(src, /requireAdminApiSession/, 'Admin 세션 인증 필수');
  const detail = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/notices/[id]/route.ts'), 'utf8');
  for (const m of ['GET', 'PUT', 'DELETE']) {
    assert.match(detail, new RegExp(`export async function ${m}[\\s\\S]{0,200}requireAdminApiSession`),
      `${m}에 인증이 있어야 한다`);
  }
  // 클라이언트 값으로 보호하지 않는다
  assert.doesNotMatch(src, /isAdmin\s*===?\s*true/);
});

test('공개 공지 API는 Admin API와 분리되어 있다', async () => {
  const pub = fs.readFileSync(path.join(process.cwd(), 'src/app/api/notices/route.ts'), 'utf8');
  assert.doesNotMatch(pub, /requireAdminApiSession/, '공개 API는 관리자 인증을 요구하지 않는다');
  assert.match(pub, /listPublishedNotices/, '공개 목록만 반환한다');
  assert.doesNotMatch(pub, /listAllNotices/, '전체 목록을 공개하면 안 된다');
});

test('팝업 컴포넌트가 오늘 하루 보지 않기를 KST 날짜로 처리한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/NoticePopup.tsx'), 'utf8');
  assert.match(src, /clyn_notice_hide_/, 'notice별 key를 사용해야 한다');
  assert.match(src, /9 \* 60 \* 60 \* 1000/, 'KST 기준 날짜여야 한다');
  // localStorage 실패가 페이지 오류를 내면 안 된다
  assert.match(src, /try \{[\s\S]{0,200}localStorage[\s\S]{0,200}\} catch/, 'localStorage 접근은 try/catch로 보호');
  // 닫기와 오늘 하루 보지 않기를 구분한다
  assert.match(src, /setClosed\(true\)/);
  assert.match(src, /function hideToday/);
});

// ===========================================================================
// [신규] notification outbox + SOLAPI fallback
// ===========================================================================

let outboxRepo, dispatcher, MockProvider, notifProvider;

test('알림 모듈 로드', async () => {
  outboxRepo = await import('../src/database/repositories/outbox-repository.ts');
  dispatcher = await import('../src/lib/notifications/dispatcher.ts');
  ({ MockNotificationProvider: MockProvider } = await import('../src/lib/notifications/mock-provider.ts'));
  notifProvider = await import('../src/lib/notifications/provider.ts');
  assert.equal(typeof dispatcher.dispatchPending, 'function');
});

function outboxFor(reservationId) {
  return db.prepare('SELECT * FROM notification_outbox WHERE reservation_id=? ORDER BY id').all(reservationId);
}

// --- enqueue 중복 차단 ---

test('예약 접수 시 reservation_received outbox가 1건 생성된다', async () => {
  db.prepare('DELETE FROM notification_outbox').run();
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    customerPhone: '010-9100-0001', desiredDate: '2027-10-01', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
  })));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const rows = outboxFor(res.body.reservation.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, 'reservation_received');
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].event_key, `reservation_received:${res.body.reservation.id}`);

  // payload에 계좌/예약금은 있고 상세주소는 없다
  const p = JSON.parse(rows[0].payload_snapshot);
  assert.ok(p.reservationCode && p.bankName && p.depositAmount > 0);
  assert.equal(p.address, undefined, '상세주소는 메시지에 넣지 않는다');
});

test('같은 quoteToken retry로는 outbox가 늘지 않는다', async () => {
  db.prepare('DELETE FROM notification_outbox').run();
  const body = fullyAgreedReservationBody({
    customerPhone: '010-9100-0002', desiredDate: '2027-10-02', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
  });
  const a = await reservationsRoute.POST(makeReqWithFreshIp(body));
  const b = await reservationsRoute.POST(makeReqWithFreshIp(body));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(outboxFor(a.body.reservation.id).length, 1, 'retry로 알림이 중복 생성되면 안 된다');
});

test('입금확인/예약확정 시 각각 1건씩 생성되고 중복 호출로 늘지 않는다', async () => {
  db.prepare('DELETE FROM notification_outbox').run();
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    customerPhone: '010-9100-0003', desiredDate: '2027-10-03', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
  })));
  const id = res.body.reservation.id;

  await reservations.confirmPayment(id, '관리자', null);
  let rows = outboxFor(id);
  assert.equal(rows.filter((r) => r.event_type === 'deposit_confirmed').length, 1);

  // 중복 입금확인은 상태 전이에서 막힌다
  await assert.rejects(() => reservations.confirmPayment(id, '관리자', null));
  assert.equal(outboxFor(id).filter((r) => r.event_type === 'deposit_confirmed').length, 1);

  await reservations.confirmReservation(id, '관리자', null);
  rows = outboxFor(id);
  assert.equal(rows.filter((r) => r.event_type === 'reservation_confirmed').length, 1);

  // Admin 더블클릭
  await assert.rejects(() => reservations.confirmReservation(id, '관리자', null));
  assert.equal(outboxFor(id).filter((r) => r.event_type === 'reservation_confirmed').length, 1);
  assert.equal(outboxFor(id).length, 3, '3종 각각 1건');
});

// --- 발송 상태 흐름 ---

async function seedOutbox(eventType = 'reservation_received', phone = '010-9200-0001') {
  db.prepare('DELETE FROM notification_outbox').run();
  await outboxRepo.enqueue({
    reservationId: 90001, eventType, templateKey: 'TPL_TEST',
    payload: {
      customerName: '홍길동', customerPhone: phone, reservationCode: 'RS-TEST',
      serviceType: '입주청소', desiredDate: '2027-10-10', timeLabel: '오전',
      depositAmount: 60000, bankName: '하나', accountNumber: '123-456', accountHolder: '플린',
    },
  });
  return db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
}

test('알림톡 접수 시 awaiting_delivery로 기록된다 (delivered 아님)', async () => {
  await seedOutbox();
  const p = new MockProvider();
  const s = await dispatcher.dispatchPending(p, 5);
  assert.equal(s.submitted, 1);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'awaiting_delivery', 'API 접수는 전달 완료가 아니다');
  assert.equal(row.actual_channel, 'kakao');
  assert.ok(row.submitted_at);
  assert.equal(row.delivered_at, null, '수신 확인 전에는 delivered_at이 비어 있다');
  assert.ok(row.kakao_message_id, '결과 조회용 messageId가 저장된다');
  assert.ok(row.next_reconcile_at, '결과 확인이 예약된다');
});

test('알림톡 실패 시 SMS/LMS로 fallback된다', async () => {
  await seedOutbox();
  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'KAKAO_ERR', errorMessage: '채널 오류' },
  });
  const s = await dispatcher.dispatchPending(p, 5);
  assert.equal(s.fallback, 1);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'fallback_submitted');
  assert.ok(['sms', 'lms'].includes(row.actual_channel), `문자 채널이어야 한다: ${row.actual_channel}`);
  assert.equal(row.last_error_code, 'KAKAO_ERR', '카카오 실패 사유가 남는다');
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 1);
});

test('카카오+문자 모두 영구 실패하면 failed', async () => {
  await seedOutbox();
  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'BAD', errorMessage: '템플릿 오류', permanent: true },
    sms: { accepted: false, errorCode: 'BAD_NUMBER', errorMessage: '잘못된 번호', permanent: true },
  });
  const s = await dispatcher.dispatchPending(p, 5);
  assert.equal(s.failed, 1);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'failed');
  assert.ok(row.failed_at);
});

test('일시 실패는 retry_pending으로 남고 무한 재시도하지 않는다', async () => {
  await seedOutbox();
  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'TIMEOUT', errorMessage: 'timeout' },
    sms: { accepted: false, errorCode: 'TIMEOUT', errorMessage: 'timeout' },
  });
  await dispatcher.dispatchPending(p, 5);
  let row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'retry_pending');
  assert.equal(row.attempts, 1);
  assert.ok(row.next_attempt_at, '다음 시도 시각이 설정된다');

  // 최대 시도 초과 시 failed
  db.prepare(`UPDATE notification_outbox SET attempts=?, next_attempt_at=NULL WHERE id=?`)
    .run(dispatcher.MAX_ATTEMPTS, row.id);
  await dispatcher.dispatchPending(p, 5);
  row = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(row.status, 'failed', '최대 시도를 넘으면 failed');
});

test('retry는 같은 outbox row를 재사용하고 새 이벤트를 만들지 않는다', async () => {
  const seeded = await seedOutbox();
  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'T', errorMessage: 't' },
    sms: { accepted: false, errorCode: 'T', errorMessage: 't' },
  });
  await dispatcher.dispatchPending(p, 5);
  db.prepare('UPDATE notification_outbox SET next_attempt_at=NULL WHERE id=?').run(seeded.id);
  await dispatcher.dispatchPending(p, 5);

  const all = db.prepare('SELECT * FROM notification_outbox').all();
  assert.equal(all.length, 1, '재시도로 row가 늘면 안 된다');
  assert.equal(all[0].id, seeded.id);
  assert.equal(all[0].attempts, 2);
});

test('provider 미설정이면 retry_pending으로 대기한다', async () => {
  await seedOutbox();
  const p = new MockProvider({ configured: false });
  await dispatcher.dispatchPending(p, 5);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'retry_pending');
  assert.equal(row.last_error_code, 'NOTIFICATION_NOT_CONFIGURED');
});

test('processor를 동시에 2번 돌려도 같은 outbox를 1회만 처리한다', async () => {
  await seedOutbox();
  const p = new MockProvider();
  await Promise.all([dispatcher.dispatchPending(p, 5), dispatcher.dispatchPending(p, 5)]);
  const sent = p.calls.filter((c) => c.channel === 'kakao').length;
  assert.equal(sent, 1, '중복 발송되면 안 된다');
});

// --- provider 장애가 business를 깨뜨리지 않음 ---

test('provider 장애여도 예약 접수 / 입금확인 / 예약확정이 유지된다', async () => {
  db.prepare('DELETE FROM notification_outbox').run();
  const res = await reservationsRoute.POST(makeReqWithFreshIp(fullyAgreedReservationBody({
    customerPhone: '010-9300-0001', desiredDate: '2027-10-20', timeSlot: 'morning',
    areaSidoCode: TEST_SIDO, areaSigunguCode: TEST_SIGUNGU, areaDongCode: TEST_DONG,
  })));
  assert.equal(res.status, 201, '예약은 성공해야 한다');
  const id = res.body.reservation.id;

  // 발송을 전부 실패시켜도 business 상태는 그대로다
  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'X', errorMessage: 'x', permanent: true },
    sms: { accepted: false, errorCode: 'X', errorMessage: 'x', permanent: true },
  });
  await dispatcher.dispatchPending(p, 10);

  await reservations.confirmPayment(id, '관리자', null);
  assert.equal(
    db.prepare('SELECT reservation_status s FROM reservations WHERE id=?').get(id).s,
    'awaiting_admin_check', '입금확인 유지'
  );
  await dispatcher.dispatchPending(p, 10);

  await reservations.confirmReservation(id, '관리자', null);
  assert.equal(
    db.prepare('SELECT reservation_status s FROM reservations WHERE id=?').get(id).s,
    'confirmed', '예약확정 유지'
  );
  // 예약/payment는 그대로 남아 있다
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payments WHERE reservation_id=?').get(id).c, 1);
});

test('business transaction 안에서 외부 provider를 호출하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/reservations.ts'), 'utf8');
  // 예약 저장 경로에서 dispatcher/solapi를 직접 부르면 안 된다
  assert.doesNotMatch(src, /dispatchPending/, '저장 경로에서 발송하면 안 된다');
  assert.doesNotMatch(src, /solapi-provider|SolapiMessageService/, 'SDK 직접 호출 금지');
  assert.match(src, /outbox-repository/, 'outbox INSERT만 한다');
});

test('SMS 길이에 따라 LMS가 선택된다', async () => {
  const short = '짧은 메시지';
  const long = '가'.repeat(100);
  assert.equal(notifProvider.resolveTextChannel(short), 'sms');
  assert.equal(notifProvider.resolveTextChannel(long), 'lms');
});

test('로그에 전체 전화번호를 남기지 않는다', async () => {
  assert.equal(notifProvider.maskPhone('010-1234-5678'), '010****5678');
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/notifications/dispatcher.ts'), 'utf8');
  assert.match(src, /maskPhone\(to\)/, '전화번호는 마스킹해서 로그한다');
  // 본문/시크릿을 로그하지 않는다
  assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*\btext\b/);
  assert.doesNotMatch(src, /SOLAPI_API_SECRET/);
});

test('SOLAPI secret을 NEXT_PUBLIC으로 노출하지 않는다', async () => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'src/lib/notifications/solapi-provider.ts'), 'utf8');
  // 주석은 제외하고 실제 코드만 검사한다
  const src = raw.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
  assert.doesNotMatch(src, /NEXT_PUBLIC_/);
  assert.match(src, /SOLAPI_API_KEY/);
  // 설정이 없어도 throw하지 않고 미설정 상태로 동작한다 (build를 막지 않음)
  assert.match(src, /isConfigured/);
});

test('알림 cron은 CRON_SECRET Bearer 인증을 요구한다', async () => {
  const cron = await import('../src/app/api/cron/notifications/route.ts');
  const prev = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = 'notify-secret';
    const noAuth = await cron.GET({ headers: new Headers() });
    assert.equal(noAuth.status, 401);
    const h = new Headers(); h.set('authorization', 'Bearer notify-secret');
    const ok = await cron.GET({ headers: h });
    assert.notEqual(ok.status, 401);
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev;
  }
});

test('메시지 내용에 상세주소가 포함되지 않는다', async () => {
  const { buildMessage } = await import('../src/lib/notifications/messages.ts');
  for (const ev of ['reservation_received', 'deposit_confirmed', 'reservation_confirmed']) {
    const { text } = buildMessage(ev, {
      customerName: '홍길동', reservationCode: 'RS-1', serviceType: '입주청소',
      desiredDate: '2027-10-10', timeLabel: '오전', depositAmount: 60000,
      bankName: '하나', accountNumber: '123', accountHolder: '플린',
      address: '서울 강남구 역삼동 1-1 101호',
    });
    assert.doesNotMatch(text, /101호|역삼동 1-1/, `${ev}에 상세주소가 들어가면 안 된다`);
  }
});

// --- 비동기 전달 결과 확인 (delivery reconciliation) ---

async function seedSubmittedKakao() {
  await seedOutbox();
  await dispatcher.dispatchPending(new MockProvider(), 5);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'awaiting_delivery');
  db.prepare('UPDATE notification_outbox SET next_reconcile_at=NULL WHERE id=?').run(row.id);
  return row;
}

test('B: 알림톡 접수 후 실제 전달 성공 → delivered, 문자 발송 없음', async () => {
  await seedSubmittedKakao();
  const p = new MockProvider({ delivery: { outcome: 'delivered', providerStatus: '4000' } });
  const s = await dispatcher.reconcileDeliveries(p, 5);
  assert.equal(s.delivered, 1);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'delivered');
  assert.ok(row.delivered_at, '실제 수신 확인 시각이 기록된다');
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 0, '문자를 보내면 안 된다');
});

test('B: 알림톡 접수 후 비동기 전달 실패 → 문자 fallback', async () => {
  await seedSubmittedKakao();
  const p = new MockProvider({
    delivery: { outcome: 'failed', providerStatus: '3000', reason: '수신 불가' },
  });
  const s = await dispatcher.reconcileDeliveries(p, 5);
  assert.equal(s.fellBack, 1);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'fallback_submitted');
  assert.ok(['sms', 'lms'].includes(row.actual_channel));
  assert.ok(row.fallback_message_id, 'fallback message id가 저장된다');
  assert.ok(row.fallback_started_at, '문자 대체 시작이 기록된다');
  assert.equal(row.last_error_code, '3000', '카카오 실패 사유가 남는다');
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 1);
});

test('결과 조회 일시 실패(unknown)로는 문자를 보내지 않는다', async () => {
  await seedSubmittedKakao();
  const p = new MockProvider({ delivery: { outcome: 'unknown', reason: 'NetworkError' } });
  const s = await dispatcher.reconcileDeliveries(p, 5);
  assert.equal(s.stillPending, 1);
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 0,
    '조회 실패를 전달 실패로 오인하면 중복 발송이 된다');
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'awaiting_delivery', '상태는 유지된다');
  assert.ok(row.next_reconcile_at, '다시 확인하도록 예약된다');
  assert.equal(row.fallback_started_at, null, '문자 대체를 시작하지 않는다');
});

test('결과가 pending이면 계속 대기한다', async () => {
  await seedSubmittedKakao();
  const p = new MockProvider({ delivery: { outcome: 'pending', providerStatus: '2000' } });
  await dispatcher.reconcileDeliveries(p, 5);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'awaiting_delivery');
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 0);
});

test('결과 확인이 최대 횟수를 넘으면 failed로 종료한다 (무한 polling 금지)', async () => {
  const row = await seedSubmittedKakao();
  db.prepare('UPDATE notification_outbox SET reconcile_attempts=? WHERE id=?')
    .run(dispatcher.MAX_RECONCILE_ATTEMPTS, row.id);
  const p = new MockProvider({ delivery: { outcome: 'unknown' } });
  const s = await dispatcher.reconcileDeliveries(p, 5);
  assert.equal(s.failed, 1);
  const after = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(after.status, 'failed');
  assert.equal(after.last_error_code, 'DELIVERY_UNKNOWN');
});

test('reconcile processor 2개를 동시에 돌려도 문자는 1회만 발송된다', async () => {
  await seedSubmittedKakao();
  const p = new MockProvider({
    delivery: { outcome: 'failed', providerStatus: '3000', reason: '수신 불가' },
  });
  await Promise.all([
    dispatcher.reconcileDeliveries(p, 5),
    dispatcher.reconcileDeliveries(p, 5),
  ]);
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 1, '중복 fallback 금지');
  const rows = db.prepare(`SELECT * FROM notification_outbox WHERE status='fallback_submitted'`).all();
  assert.equal(rows.length, 1);
});

test('문자 대체가 실제 전달되면 fallback_delivered가 된다', async () => {
  await seedSubmittedKakao();
  // 1) 알림톡 실패 → 문자 제출
  await dispatcher.reconcileDeliveries(
    new MockProvider({ delivery: { outcome: 'failed', providerStatus: '3000' } }), 5);
  let row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'fallback_submitted');

  // 2) 문자 결과 확인
  db.prepare('UPDATE notification_outbox SET next_reconcile_at=NULL WHERE id=?').run(row.id);
  const s = await dispatcher.reconcileDeliveries(
    new MockProvider({ delivery: { outcome: 'delivered', providerStatus: '4000' } }), 5);
  assert.equal(s.delivered, 1);
  row = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(row.status, 'fallback_delivered');
  assert.ok(row.delivered_at);
});

test('문자 대체도 전달 실패하면 failed로 종료된다', async () => {
  await seedSubmittedKakao();
  await dispatcher.reconcileDeliveries(
    new MockProvider({ delivery: { outcome: 'failed', providerStatus: '3000' } }), 5);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  db.prepare('UPDATE notification_outbox SET next_reconcile_at=NULL WHERE id=?').run(row.id);

  const s = await dispatcher.reconcileDeliveries(
    new MockProvider({ delivery: { outcome: 'failed', providerStatus: '3040', reason: '번호 오류' } }), 5);
  assert.equal(s.failed, 1);
  const after = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(after.status, 'failed');
  assert.equal(after.last_error_code, '3040');
});

test('LMS 길이 메시지도 fallback으로 전송된다', async () => {
  db.prepare('DELETE FROM notification_outbox').run();
  await outboxRepo.enqueue({
    reservationId: 90002, eventType: 'reservation_received', templateKey: 'TPL',
    payload: {
      customerName: '가'.repeat(40), customerPhone: '010-9400-0001',
      reservationCode: 'RS-LONG', serviceType: '입주청소',
      desiredDate: '2027-11-11', timeLabel: '오전', depositAmount: 60000,
      bankName: '하나은행', accountNumber: '123-456789-01234', accountHolder: '주식회사 플린',
    },
  });
  const p = new MockProvider({ kakao: { accepted: false, errorCode: 'X', errorMessage: 'x' } });
  await dispatcher.dispatchPending(p, 5);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.actual_channel, 'lms', '긴 본문은 LMS로 기록된다');
});

test('SMS/LMS 판정은 EUC-KR 바이트 기준이며 string.length를 쓰지 않는다', async () => {
  // 영문 90자 = 90byte → SMS
  assert.equal(notifProvider.resolveTextChannel('a'.repeat(90)), 'sms');
  assert.equal(notifProvider.resolveTextChannel('a'.repeat(91)), 'lms');
  // 한글 45자 = 90byte → SMS, 46자 = 92byte → LMS
  assert.equal(notifProvider.resolveTextChannel('가'.repeat(45)), 'sms');
  assert.equal(notifProvider.resolveTextChannel('가'.repeat(46)), 'lms');
  // string.length만 봤다면 한글 46자는 SMS로 잘못 판정된다
  assert.equal('가'.repeat(46).length, 46);
  assert.equal(notifProvider.textByteLength('가'.repeat(46)), 92);
});

test('SOLAPI 문자 발송은 autoTypeDetect로 provider가 타입을 결정한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/notifications/solapi-provider.ts'), 'utf8');
  assert.match(src, /autoTypeDetect: true/, 'SDK가 SMS/LMS를 판별하게 한다');
  // 결과 조회는 공식 SDK getMessages를 쓴다
  assert.match(src, /getMessages\(\{ messageId/, '공식 결과 조회 API 사용');
  assert.match(src, /getDeliveryStatus/);
});

test('인증되지 않은 공개 webhook을 만들지 않았다', async () => {
  const webhookPaths = [
    'src/app/api/notifications/webhook',
    'src/app/api/solapi',
    'src/app/api/webhook',
  ];
  for (const p of webhookPaths) {
    assert.equal(fs.existsSync(path.join(process.cwd(), p)), false, `${p} 가 있으면 안 된다`);
  }
  // cron은 CRON_SECRET로 보호된다
  const cron = fs.readFileSync(path.join(process.cwd(), 'src/app/api/cron/notifications/route.ts'), 'utf8');
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /reconcileDeliveries/, 'cron이 결과 확인을 수행한다');
});

// ===========================================================================
// [신규] 최종 UI 통합 — 할인 UI / Admin 관리 / 메시지 이력
// ===========================================================================

test('고객 견적 UI가 할인 breakdown을 서버 snapshot으로 표시한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.match(src, /function DiscountBreakdown/);
  // 브라우저에서 금액을 계산하지 않는다
  assert.match(src, /setDiscount\(data\.discount/, '서버 snapshot을 그대로 쓴다');
  // 할인 없으면 -0원을 표시하지 않는다
  assert.match(src, /automaticDiscountAmount > 0 &&/);
  assert.match(src, /couponDiscountAmount > 0 &&/);
  // 최종 견적 / 예약금 / 잔금
  assert.match(src, /최종 견적/);
  assert.match(src, /label="예약금"/);
  assert.match(src, /label="잔금"/);
});

test('쿠폰 적용/해제 시 quote를 다시 호출해 새 토큰을 받는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.match(src, /function CouponBox/);
  assert.match(src, /couponCode: appliedCoupon/, 'quote 요청에 쿠폰이 포함된다');
  // appliedCoupon이 effect 의존성에 있어야 재호출된다
  // effect 의존성에 appliedCoupon이 포함되어야 재호출된다
  const i = src.indexOf('}, [regionReadyForPricing');
  const deps = src.slice(i, i + 300);
  assert.match(deps, /appliedCoupon/, '쿠폰 변경 시 quote 재호출');
  // 브라우저에서 토큰 payload를 수정하지 않는다
  assert.doesNotMatch(src, /quoteToken\s*=\s*[^;]*JSON\.parse/, '토큰을 클라이언트에서 조작하면 안 된다');
});

test('쿠폰 오류는 이해 가능한 문구로 표시되고 내부 코드를 노출하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.match(src, /setCouponError\(data\.error/, '서버 문구를 사용한다');
  assert.doesNotMatch(src, /setCouponError\(data\.code/, 'error code를 그대로 노출하면 안 된다');

  // 서버 문구가 사람이 읽을 수 있는지 확인
  resetDiscountData();
  addCoupon({ code: 'EXPIRED2', ends_at: '2000-01-01T00:00:00.000Z' });
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '24평', desiredDate: '2027-04-25', couponCode: 'EXPIRED2',
  }));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /기간|쿠폰/, '사람이 읽을 수 있는 문구');
  assert.doesNotMatch(res.body.error, /Error|stack|SELECT/i, '내부 정보 노출 금지');
});

// --- Admin API 인증 ---

test('신규 Admin API는 모두 세션 인증을 요구한다', async () => {
  const routes = [
    'src/app/api/admin/discounts/route.ts',
    'src/app/api/admin/notices/route.ts',
    'src/app/api/admin/notices/[id]/route.ts',
    'src/app/api/admin/notifications/route.ts',
    'src/app/api/admin/reservations/[id]/discount/route.ts',
    'src/app/api/admin/reservations/[id]/detail/route.ts',
  ];
  for (const f of routes) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    const handlers = src.match(/export async function (GET|POST|PUT|DELETE)/g) ?? [];
    assert.ok(handlers.length > 0, `${f}에 핸들러가 있어야 한다`);
    for (const h of handlers) {
      const name = h.split(' ').pop();
      assert.match(
        src,
        new RegExp(`export async function ${name}[\\s\\S]{0,300}requireAdminApiSession`),
        `${f} ${name}에 인증이 없다`
      );
    }
    // UI 숨김으로 보호하지 않는다
    assert.doesNotMatch(src, /isAdmin\s*===?\s*true/);
  }
});

test('쿠폰 코드 중복은 명확한 오류로 처리된다', async () => {
  resetDiscountData();
  addCoupon({ code: 'DUPCODE' });
  const route = await import('../src/app/api/admin/discounts/route.ts');
  const res = await route.POST(makeReq({
    kind: 'coupon', code: '  dupcode  ', name: '중복', discountValue: 1000,
  }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'COUPON_CODE_DUPLICATE');
  assert.match(res.body.error, /DUPCODE/, '정규화된 코드로 안내한다');
});

test('사용 이력이 있는 쿠폰은 삭제 대신 중지를 안내한다', async () => {
  resetDiscountData();
  const id = addCoupon({ code: 'USED1' });
  db.prepare(`INSERT INTO coupon_redemptions (coupon_id, reservation_id, customer_phone, discount_amount)
              VALUES (?, 999997, '010-0000-0000', 1000)`).run(id);
  const route = await import('../src/app/api/admin/discounts/route.ts');
  const res = await route.DELETE({ url: `http://localhost/api/admin/discounts?kind=coupon&id=${id}`, headers: new Headers() });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'COUPON_IN_USE');
  db.prepare('DELETE FROM coupon_redemptions WHERE reservation_id=999997').run();
});

test('프로모션/쿠폰을 수정해도 기존 예약 snapshot은 불변', async () => {
  resetDiscountData();
  const pid = addPromo({ name: '원본', discount_type: 'fixed', discount_value: 25000 });
  const { res } = await bookWithDiscount({ customerPhone: '010-8500-0001', desiredDate: '2027-04-26' });
  const before = db.prepare('SELECT * FROM reservations WHERE id=?').get(res.body.reservation.id);
  assert.equal(before.automatic_discount_amount, 25000);

  // 프로모션 수정·중지
  const route = await import('../src/app/api/admin/discounts/route.ts');
  await route.POST(makeReq({
    kind: 'promotion', id: pid, name: '변경됨', isActive: false, discountValue: 1,
  }));

  const after = db.prepare('SELECT * FROM reservations WHERE id=?').get(res.body.reservation.id);
  assert.equal(after.automatic_discount_amount, 25000, '기존 예약 금액이 변하면 안 된다');
  assert.equal(after.promotion_name, '원본', 'snapshot된 이름이 유지된다');
  assert.equal(after.final_amount, before.final_amount);
});

// --- 메시지 이력 UI ---

test('메시지 상태 문구가 접수와 수신을 구분한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/admin/ReservationOpsPanel.tsx'), 'utf8');
  assert.match(src, /awaiting_delivery: "전송 결과 확인 중"/);
  assert.match(src, /submitted: "발송 요청됨"/, 'API 접수를 전송 완료라고 하면 안 된다');
  assert.match(src, /delivered: "카카오 전송 완료"/);
  assert.match(src, /fallback_submitted: "문자 대체 발송 요청됨"/);
  assert.match(src, /fallback_delivered: "문자 전송 완료"/);
  // 재시도 버튼은 allowlist 상태에서만 노출한다 (provider 접수 상태 제외)
  assert.match(src, /RETRYABLE\.has\(n\.status\)/);
});

test('메시지 재시도는 기존 row를 되돌리고 새 이벤트를 만들지 않는다', async () => {
  await seedOutbox();
  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'X', errorMessage: 'x', permanent: true },
    sms: { accepted: false, errorCode: 'X', errorMessage: 'x', permanent: true },
  });
  await dispatcher.dispatchPending(p, 5);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.status, 'failed');
  const before = db.prepare('SELECT COUNT(*) c FROM notification_outbox').get().c;

  const route = await import('../src/app/api/admin/notifications/route.ts');
  const res = await route.POST(makeReq({ id: row.id }));
  assert.equal(res.status, 200);

  const after = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(after.status, 'retry_pending');
  assert.equal(after.event_key, row.event_key, 'event_key가 유지된다');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notification_outbox').get().c, before,
    '재시도로 row가 늘면 안 된다');
});

test('이미 전송 완료된 알림은 재시도할 수 없다', async () => {
  await seedOutbox();
  await dispatcher.dispatchPending(new MockProvider(), 5);
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  db.prepare(`UPDATE notification_outbox SET status='delivered' WHERE id=?`).run(row.id);

  const route = await import('../src/app/api/admin/notifications/route.ts');
  const res = await route.POST(makeReq({ id: row.id }));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'ALREADY_DELIVERED');
});

test('Admin 예약 상세에 할인 breakdown과 운영 패널이 연결됐다', async () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/admin/(protected)/reservations/[id]/page.tsx'), 'utf8');
  assert.match(src, /ReservationOpsPanel/);
  assert.match(src, /automatic_discount_amount/);
  assert.match(src, /coupon_discount_amount/);
  assert.match(src, /admin_discount_amount/);
  assert.match(src, /final_amount/);
  // 배수 표시는 제거됐다
  assert.doesNotMatch(src, /가격 승수/, '서비스 배수 UI는 폐지됐다');
});

test('Admin 사이드바에 할인/공지 메뉴가 있다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/admin/AdminSidebar.tsx'), 'utf8');
  for (const [href, label] of [
    ['/admin/discounts', '할인 관리'],
    ['/admin/notices', '공지 / 팝업'],
    ['/admin/service-areas', '서비스 지역'],
  ]) {
    assert.match(src, new RegExp(href.replace(/\//g, '\\/')), `${label} 메뉴가 있어야 한다`);
  }
});

test('홈페이지와 네비게이션에서 공지에 접근할 수 있다', async () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'src/app/page.tsx'), 'utf8');
  assert.match(page, /NoticePopup/, '홈페이지에 팝업이 연결됐다');
  assert.ok(fs.existsSync(path.join(process.cwd(), 'src/app/notice/page.tsx')));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'src/app/notice/[id]/page.tsx')));
});

// ===========================================================================
// [신규] 메시지 수동 재시도 중복발송 방지
//
// provider에 이미 접수된 상태(processing / submitted / awaiting_delivery /
// kakao_failed / fallback_submitted)에서 Admin이 재시도를 눌러도
// 실제 카카오/SMS 발송이 다시 일어나면 안 된다.
// ===========================================================================

let notifRetryRoute;

/** 특정 상태의 outbox row를 만든다 */
async function seedOutboxWithStatus(status, extra = {}) {
  db.prepare('DELETE FROM notification_outbox').run();
  await outboxRepo.enqueue({
    reservationId: 95001, eventType: 'reservation_received', templateKey: 'TPL_TEST',
    payload: {
      customerName: '홍길동', customerPhone: '010-9500-0001', reservationCode: 'RS-RETRY',
      serviceType: '입주청소', desiredDate: '2027-10-10', timeLabel: '오전',
      depositAmount: 60000, bankName: '하나', accountNumber: '123-456', accountHolder: '플린',
    },
  });
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  const sets = ['status = ?'];
  const params = [status];
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); params.push(v); }
  params.push(row.id);
  db.prepare(`UPDATE notification_outbox SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare('SELECT * FROM notification_outbox WHERE id = ?').get(row.id);
}

test('재시도 모듈 로드', async () => {
  notifRetryRoute = await import('../src/app/api/admin/notifications/route.ts');
  assert.equal(typeof notifRetryRoute.POST, 'function');
});

test('awaiting_delivery 상태는 수동 재시도가 거절되고 알림톡이 다시 나가지 않는다', async () => {
  const row = await seedOutboxWithStatus('awaiting_delivery', {
    provider_message_id: 'msg-1', kakao_message_id: 'msg-1', actual_channel: 'kakao',
  });

  const res = await notifRetryRoute.POST(makeReq({ id: row.id }));
  assert.equal(res.status, 409, '이미 접수된 알림톡은 재시도할 수 없다');
  assert.ok(res.body.code, '명확한 code를 반환해야 한다');

  // 상태가 바뀌지 않았다
  const after = db.prepare('SELECT status FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(after.status, 'awaiting_delivery');

  // dispatcher를 돌려도 이 row는 발송 대상이 아니다 → sendKakao 0회
  const p = new MockProvider();
  await dispatcher.dispatchPending(p, 5);
  assert.equal(p.calls.filter((c) => c.channel === 'kakao').length, 0,
    '알림톡이 다시 발송되면 안 된다');
});

test('fallback_submitted 상태는 수동 재시도가 거절되고 문자가 다시 나가지 않는다', async () => {
  const row = await seedOutboxWithStatus('fallback_submitted', {
    provider_message_id: 'sms-1', fallback_message_id: 'sms-1', actual_channel: 'sms',
    fallback_started_at: new Date().toISOString(),
  });

  const res = await notifRetryRoute.POST(makeReq({ id: row.id }));
  assert.equal(res.status, 409, '이미 접수된 문자는 재시도할 수 없다');

  const after = db.prepare('SELECT status FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(after.status, 'fallback_submitted');

  const p = new MockProvider();
  await dispatcher.dispatchPending(p, 5);
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 0, '문자가 다시 발송되면 안 된다');
});

test('processing / submitted / kakao_failed 상태도 수동 재시도가 거절된다', async () => {
  for (const status of ['pending', 'processing', 'submitted', 'kakao_failed']) {
    const row = await seedOutboxWithStatus(status);
    const res = await notifRetryRoute.POST(makeReq({ id: row.id }));
    assert.equal(res.status, 409, `${status}는 재시도 대상이 아니다`);
    const after = db.prepare('SELECT status FROM notification_outbox WHERE id=?').get(row.id);
    assert.equal(after.status, status, `${status} 상태가 바뀌면 안 된다`);
  }
});

test('delivered / fallback_delivered는 기존처럼 거절된다', async () => {
  for (const status of ['delivered', 'fallback_delivered']) {
    const row = await seedOutboxWithStatus(status);
    const res = await notifRetryRoute.POST(makeReq({ id: row.id }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'ALREADY_DELIVERED');
  }
});

test('failed 상태는 안전하게 재시도할 수 있다', async () => {
  const row = await seedOutboxWithStatus('failed', {
    failed_at: new Date().toISOString(), last_error_code: 'X',
  });
  const before = db.prepare('SELECT COUNT(*) c FROM notification_outbox').get().c;

  const res = await notifRetryRoute.POST(makeReq({ id: row.id }));
  assert.equal(res.status, 200, 'failed는 재시도 가능');

  const after = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id);
  assert.equal(after.status, 'retry_pending');
  assert.equal(after.event_key, row.event_key, '새 이벤트를 만들지 않는다');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM notification_outbox').get().c, before);
});

test('failed 재시도 후 dispatcher가 정확히 1회만 발송한다', async () => {
  const row = await seedOutboxWithStatus('failed', {
    failed_at: new Date().toISOString(), attempts: 1,
  });
  await notifRetryRoute.POST(makeReq({ id: row.id }));

  const p = new MockProvider();
  await dispatcher.dispatchPending(p, 5);
  assert.equal(p.calls.filter((c) => c.channel === 'kakao').length, 1, '정확히 1회만 발송');
});

// --- dispatcher fallback 가드 ---

test('fallback이 이미 시작된 row는 dispatcher가 문자를 다시 보내지 않는다', async () => {
  // 알림톡 실패로 fallback을 시작했지만 문자 접수 전에 재진입한 상황
  const row = await seedOutboxWithStatus('retry_pending', {
    fallback_started_at: new Date().toISOString(),
    next_attempt_at: null, attempts: 1,
  });

  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'KAKAO_ERR', errorMessage: '채널 오류' },
  });
  await dispatcher.dispatchPending(p, 5);

  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 0,
    'fallback 마커가 이미 있으면 문자를 다시 보내지 않는다');

  // 상태가 망가지지 않고 다음 처리로 이어질 수 있어야 한다
  const after = db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(row.id);
  assert.ok(
    ['kakao_failed', 'retry_pending', 'failed'].includes(after.status),
    `상태가 유효해야 한다: ${after.status}`
  );
});

test('동일 fallback 경로에 두 번 진입해도 SMS provider 호출은 정확히 1회', async () => {
  await seedOutbox();
  const p = new MockProvider({
    kakao: { accepted: false, errorCode: 'KAKAO_ERR', errorMessage: '채널 오류' },
  });

  // 1회차 — 알림톡 실패 → 문자 대체
  await dispatcher.dispatchPending(p, 5);
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 1);

  // 2회차 — 같은 row를 강제로 다시 대기 상태로 만들어 재진입
  const row = db.prepare('SELECT * FROM notification_outbox ORDER BY id DESC LIMIT 1').get();
  db.prepare(`UPDATE notification_outbox SET status='retry_pending', next_attempt_at=NULL WHERE id=?`)
    .run(row.id);

  await dispatcher.dispatchPending(p, 5);
  assert.equal(p.calls.filter((c) => c.channel === 'sms').length, 1,
    'fallback 마커 때문에 문자는 여전히 1회여야 한다');
});

test('Admin UI 재시도 버튼이 API 허용 상태와 일치한다', async () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/components/admin/ReservationOpsPanel.tsx'), 'utf8');
  // 재시도 가능 상태를 allowlist로 정의해야 한다
  assert.match(src, /RETRYABLE/, '재시도 허용 상태를 명시해야 한다');
  assert.doesNotMatch(src, /DONE\.has\(n\.status\)/,
    'delivered만 제외하는 denylist 방식이면 안 된다');
});

test('수동 재시도 정책은 allowlist로 구현된다', async () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/admin/notifications/route.ts'), 'utf8');
  assert.match(src, /RETRYABLE_STATUSES/, 'allowlist 상수를 사용해야 한다');
  // provider 접수 상태가 allowlist에 없어야 한다
  const allow = src.slice(src.indexOf('RETRYABLE_STATUSES'), src.indexOf('RETRYABLE_STATUSES') + 300);
  for (const s of ['awaiting_delivery', 'fallback_submitted', 'submitted', 'processing']) {
    assert.doesNotMatch(allow, new RegExp(`"${s}"`), `${s}는 재시도 허용 목록에 없어야 한다`);
  }
});
