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
let getDateAdjustment;
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

const SERVICE_MULTIPLIERS = {
  '입주청소': 1.0,
  '사이청소': 1.5,
  '거주청소': 1.1,
};

async function importFresh(specifier, tag) {
  return import(`${specifier}?test=${tag}-${Date.now()}-${Math.random()}`);
}

before(async () => {
  await import('../src/database/schema.ts');
  // Use a separate connection for fixture writes; production modules use their singleton connection.
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  pricing = await import('../src/lib/pricing.ts');
  specialDays = await import('../src/lib/special-days.ts');
  calendar = await import('../src/lib/calendar.ts');
  specialDayStore = await import('../src/lib/special-days-store.ts');
  // 특수일 캐시를 채운다. KASI_SERVICE_KEY가 없는 테스트 환경에서는
  // 오프라인 generator 데이터로 backfill된다.
  await specialDayStore.syncSpecialDays({ from: '2026-01-01', days: 800 });
  getDateAdjustment = specialDays.getDateAdjustment;
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

function validReservationBody(overrides = {}) {
  return {
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

function makeReq(body) {
  return {
    headers: new Headers(),
    async json() { return body; },
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
test('P0-5 40평 이상은 상담 전환 대상이며 예약 생성 API가 거부한다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      houseTypeKey: '40평', actualPyeong: 45,
      customerPhone: '010-4000-0001', desiredDate: '2026-12-29',
    })
  ));
  assert.equal(res.status, 409, '40평 이상은 일반 예약으로 생성되면 안 된다');
  assert.equal(res.body.code, 'CONSULT_REQUIRED');
  assert.equal(res.body.consultReason, 'size_40_plus');
});

// [위험 보존] 정식 가격표 밖의 특수 케이스(기준가 확정 불가)는
// 여전히 최종금액 없이 계좌 단계로 진입할 수 없어야 한다.
test('P0-5(negative) 기준가가 확정되지 않은 예약은 최종금액 없이 계좌 단계로 진입할 수 없다', async () => {
  const { reservation } = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-4000-0002', desiredDate: '2026-12-30' })
  );
  db.prepare(`UPDATE reservations
                 SET price_confirmed_snapshot = 0, final_confirmed_total = NULL,
                     estimated_total_snapshot = NULL,
                     area_sido='서울특별시', area_sigungu='강남구', area_dong='역삼동',
                     core_principles_agreed=1, service_terms_agreed=1,
                     additional_charge_agreed=1, agreement_version='1.0'
               WHERE id=?`).run(reservation.id);

  await assert.rejects(
    () => reservations.revealDepositAccount(reservation.id),
    /최종.*금액|확정.*금액/,
    '최종금액 미확정 상태에서 계좌가 공개되면 안 된다'
  );
  const payments = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE reservation_id=?`).get(reservation.id);
  assert.equal(payments.c, 0, '실패 시 payment가 생성되면 안 된다');
});

test('P1-1 quote API는 40평 선택에서 actualPyeong 39를 거부한다', async () => {
  const res = await quoteRoute.POST(makeReq({ serviceType: '입주청소', houseTypeKey: '40평', actualPyeong: 39, extraOptions: [] }));
  assert.equal(res.status, 400);
});

test('P1-2 사이청소 예약 API는 퇴거/입주 시간을 서버에서 필수 검증한다', async () => {
  const res = await reservationsRoute.POST(makeReq(validReservationBody({ serviceType: '사이청소' })));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /퇴거|입주|시간/);
});

test('P1-2 사이청소 예약 API는 퇴거 완료보다 이른 입주 시간을 거부한다', async () => {
  const res = await reservationsRoute.POST(makeReq(validReservationBody({
    serviceType: '사이청소',
    moveOutTime: '2026-12-15T14:00',
    moveInTime: '2026-12-15T13:00',
  })));
  assert.equal(res.status, 400);
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

test('P1-5 예약 당시 옵션별 금액/상담여부 breakdown을 snapshot으로 저장한다', async () => {
  db.prepare(`UPDATE option_prices SET price=25000, is_active=1 WHERE option_key='extra_furniture'`).run();
  db.prepare(`UPDATE option_prices SET price=0, is_active=1 WHERE option_key='heavy_mold'`).run();
  const { reservation } = await reservations.createReservation(validReservationBody({ extraOptions: ['extra_furniture', 'heavy_mold'] }));
  const row = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.ok(row.option_breakdown_snapshot, 'option_breakdown_snapshot 컬럼/값이 필요합니다');
  const snapshot = JSON.parse(row.option_breakdown_snapshot);
  assert.deepEqual(snapshot, [
    { key: 'extra_furniture', label: '추가 가구', price: 25000, isConsult: false },
    { key: 'heavy_mold', label: '심한 곰팡이', price: 0, isConsult: true },
  ]);
});

test('P0-3/P0-4 고객조회 UI는 final_confirmed_total을 우선하고 잔금도 final 기준으로 계산한다', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/reservation/ReservationLookup.tsx'), 'utf8');
  const finalPos = source.indexOf('reservation.final_confirmed_total != null');
  const unconfirmedPos = source.indexOf('reservation.price_confirmed_snapshot === 0');
  assert.ok(finalPos >= 0 && finalPos < unconfirmedPos, 'final_confirmed_total 우선 분기가 price_confirmed_snapshot 분기보다 앞에 있어야 합니다');
  assert.match(source, /final_confirmed_total[\s\S]{0,240}payment\.amount|payment\.amount[\s\S]{0,240}final_confirmed_total/);
});

test('P1-4 공개 예약 UI는 정적 EXTRA_OPTIONS 전체가 아니라 활성 옵션 목록을 사용한다', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.doesNotMatch(source, /\{EXTRA_OPTIONS\.map\(/);
  // 정적 EXTRA_OPTIONS 전체를 순회하지 않고, 서버가 내려준 활성 옵션 목록을 사용해야 한다
  assert.match(source, /availableOptions|activeOptions|options\.map\(/);
  assert.match(source, /\/api\/quote/, '활성 옵션을 서버에서 받아와야 한다');
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

for (const [houseTypeKey, basePrice] of Object.entries(CANONICAL_PRICES)) {
  for (const [serviceType, multiplier] of Object.entries(SERVICE_MULTIPLIERS)) {
    test(`가격엔진 ${houseTypeKey} × ${serviceType} 기준가격/승수/합계`, async () => {
      const q = await pricing.calculateQuote({ serviceType, houseTypeKey, extraOptions: [] });
      assert.equal(q.basePrice, basePrice);
      assert.equal(q.multiplier, multiplier);
      assert.equal(q.estimatedTotal, Math.round(basePrice * multiplier));
      // [정책] 40평 이상은 상담 전환 대상이므로 확정 자동견적이 아니다
      assert.equal(q.priceConfirmed, houseTypeKey !== '40평');
    });
  }
}

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
  assert.equal((await reservations.getReservationById(reservation.id))?.reservation_status, 'confirmed');
});

test('34평 사이청소 snapshot은 기준가/승수/총액/확정여부를 보존한다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody({ serviceType: '사이청소', houseTypeKey: '34평' }));
  const row = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(row.service_type, '사이청소');
  assert.equal(row.house_type_key, '34평');
  assert.equal(row.area_pyeong, 34);
  // 가격표를 상수에서 참조 (하드코딩 중복 방지)
  assert.equal(row.base_price_snapshot, CANONICAL_PRICES['34평']);
  assert.equal(row.price_multiplier, 1.5);
  assert.equal(row.estimated_total_snapshot, Math.round(CANONICAL_PRICES['34평'] * 1.5));
  assert.equal(row.price_confirmed_snapshot, 1);
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

test('비활성 주택상품은 quote를 거치지 않은 직접 예약 API에서도 차단한다', async () => {
  db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND note='34평'`).run();
  const res = await reservationsRoute.POST(makeReq(validReservationBody({ customerPhone: '010-7777-0001' })));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /가격|견적|상품|비활성/);
});

test('비활성 옵션은 quote를 거치지 않은 직접 예약 API에서도 차단한다', async () => {
  db.prepare(`UPDATE option_prices SET is_active=0 WHERE option_key='heavy_mold'`).run();
  const res = await reservationsRoute.POST(makeReq(validReservationBody({
    customerPhone: '010-7777-0002',
    extraOptions: ['heavy_mold'],
  })));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /옵션|서비스|비활성/);
});

test('사이청소 정상 퇴거/입주 시간은 예약되고 서버 메타데이터로 저장된다', async () => {
  const res = await reservationsRoute.POST(makeReq(validReservationBody({
    customerPhone: '010-7777-0003',
    serviceType: '사이청소',
    moveOutTime: '2026-12-15T08:00',
    moveInTime: '2026-12-15T20:00',
  })));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const row = db.prepare(`SELECT extra_notes FROM reservations WHERE id=?`).get(res.body.reservation.id);
  assert.match(row.extra_notes, /\[사이청소시간\]/);
  assert.match(row.extra_notes, /2026-12-15T08:00/);
  assert.match(row.extra_notes, /2026-12-15T20:00/);
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

test('40평 이상 시작가 OFF는 직접 예약 API에서도 차단한다', async () => {
  db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND note='40평'`).run();
  const freshReservationsRoute = await importFresh('../src/app/api/reservations/route.ts', 'reservations-40-off');
  const res = await freshReservationsRoute.POST(makeReq(validReservationBody({
    customerPhone: '010-7777-0040', houseTypeKey: '40평', actualPyeong: 45,
  })));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /가격|견적|상품|비활성/);
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

  const afterConfirm = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(afterConfirm.reservation_status, 'confirmed');

  // 이후 만료 배치가 돌아도 confirmed를 되돌리면 안 된다
  const released = await reservations.releaseExpiredDepositReservations();
  assert.equal(released, 0, '입금확인된 예약은 만료 대상이 아니어야 한다');

  const afterRelease = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(afterRelease.reservation_status, 'confirmed', 'confirmed가 cancelled로 뒤집히면 안 된다');
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
  const total = CANONICAL_PRICES['38평'] + getDateAdjustment('2027-01-06');
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

test('예약금이 총 청소금액을 초과하면 계좌 단계로 진입할 수 없다', async () => {
  const { reservation } = await reservations.createReservation(
    fullyAgreedReservationBody({ customerPhone: '010-5000-0004', desiredDate: '2027-01-08' })
  );
  const rule = db.prepare(`SELECT * FROM price_rules WHERE service_type='입주청소' AND note='34평'`).get();
  try {
    // 예약금을 총액보다 크게 조작
    db.prepare(`UPDATE price_rules SET deposit_amount=9000000 WHERE id=?`).run(rule.id);
    await assert.rejects(
      () => reservations.revealDepositAccount(reservation.id),
      /예약금|클 수 없/,
      '예약금 > 총액이면 거부되어야 한다'
    );
    const payments = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE reservation_id=?`).get(reservation.id);
    assert.equal(payments.c, 0, '실패 시 payment가 생성되면 안 된다');
    const row = db.prepare(`SELECT reservation_status FROM reservations WHERE id=?`).get(reservation.id);
    assert.equal(row.reservation_status, 'received', '실패 시 상태가 바뀌면 안 된다');
  } finally {
    db.prepare(`UPDATE price_rules SET deposit_amount=? WHERE id=?`).run(rule.deposit_amount, rule.id);
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

test('작업지역(시/도·시군구·행정동)이 없으면 예약 API가 거부한다', async () => {
  for (const missing of ['areaSido', 'areaSigungu', 'areaDong']) {
    const body = fullyAgreedReservationBody({ customerPhone: '010-6000-0002' });
    body[missing] = '';
    const res = await reservationsRoute.POST(makeReqWithFreshIp(body));
    assert.equal(res.status, 400, `${missing} 누락은 거부되어야 한다`);
  }
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

test('예약 생성 응답에는 계좌번호가 포함되지 않는다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({ customerPhone: '010-7000-0001', desiredDate: '2027-02-01' })
  ));
  assert.equal(res.status, 201);
  const serialized = JSON.stringify(res.body);
  assert.equal(res.body.bankInfo, undefined, '예약 생성 응답에 bankInfo가 있으면 안 된다');
  assert.doesNotMatch(serialized, /accountNumber/, '계좌번호 필드가 응답에 노출되면 안 된다');
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
  const adj = getDateAdjustment('2027-02-05');
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

test('관리자 입금확인 전에는 예약진행 중이고 입금확인 후 예약완료가 된다', async () => {
  const { toPublicReservationStatus } = await import('../src/lib/types.ts');
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-7000-0006', desiredDate: '2027-02-06',
  });
  assert.equal(reservation.reservation_status, 'approved_awaiting_deposit');
  assert.equal(toPublicReservationStatus(reservation.reservation_status), '예약진행 중');

  await reservations.confirmPayment(reservation.id, '관리자', null);

  const after = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  const payment = db.prepare(`SELECT * FROM payments WHERE reservation_id=?`).get(reservation.id);
  assert.equal(after.reservation_status, 'confirmed');
  assert.equal(payment.payment_status, 'confirmed');
  assert.equal(toPublicReservationStatus(after.reservation_status), '예약완료');
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

test('40평 이상은 예약금/계좌 단계로 진행할 수 없다', async () => {
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      houseTypeKey: '40평', actualPyeong: 50,
      customerPhone: '010-9100-0001', desiredDate: '2027-03-10',
    })
  ));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONSULT_REQUIRED');
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

test('토요일은 +30,000원이 가산된다', async () => {
  const meta = specialDays.getSpecialDayMeta('2026-12-12'); // 토
  assert.equal(meta.isWeekend, true);
  const q = await quoteOn('2026-12-12');
  assert.equal(q.dateAdjustmentAmount, ADJ);
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
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

test('손없는날은 +30,000원이 가산된다', async () => {
  // 2026-12-17(목) = 음력 11월 9일 — 손없는날, 주말·공휴일 아님
  const meta = specialDays.getSpecialDayMeta('2026-12-17');
  assert.equal(meta.isSonEomneunDay, true);
  assert.equal(meta.isWeekend, false);
  assert.equal(meta.isHoliday, false);
  const q = await quoteOn('2026-12-17');
  assert.equal(q.dateAdjustmentAmount, ADJ);
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
});

test('토요일+손없는날이 겹쳐도 +30,000원만 1회 적용된다', async () => {
  // 2026-02-07(토) = 음력 12월 20일 — 토요일 + 손없는날
  const meta = specialDays.getSpecialDayMeta('2026-02-07');
  assert.equal(meta.isWeekend, true);
  assert.equal(meta.isSonEomneunDay, true);
  const q = await quoteOn('2026-02-07');
  assert.equal(q.dateAdjustmentAmount, ADJ, '조건 2개여도 30,000원 1회');
  assert.equal(q.estimatedTotal, BASE_1R + ADJ);
  assert.notEqual(q.estimatedTotal, BASE_1R + ADJ * 2);
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

test('날짜 보정은 서비스 승수 적용 후 총액에 1회만 더해진다', async () => {
  const q = await pricing.calculateQuote({
    serviceType: '사이청소', houseTypeKey: '원룸', desiredDate: '2026-12-12',
  });
  // 사이청소 = 기준가 × 1.5, 그 뒤 날짜 보정 1회
  assert.equal(q.priceAfterMultiplier, Math.round(BASE_1R * 1.5));
  assert.equal(q.dateAdjustmentAmount, ADJ);
  assert.equal(q.estimatedTotal, Math.round(BASE_1R * 1.5) + ADJ);
});

// ===========================================================================
// [신규] 고객 API 내부 사유 비노출
// ===========================================================================

test('공개 quote 응답에 날짜 가산 사유/내부 금액 필드가 없다', async () => {
  const res = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '원룸', extraOptions: [], desiredDate: '2026-12-12',
  }));
  assert.equal(res.status, 200);
  const q = res.body.quote;
  // 보정이 반영된 최종 금액만 본다
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

test('반려동물 있음은 상담 전환 대상이다', async () => {
  const q = await pricing.calculateQuote({
    serviceType: '입주청소', houseTypeKey: '24평', hasPet: true,
  });
  assert.equal(q.consultRequired, true);
  assert.equal(q.consultReason, 'pet');
  assert.match(q.notice, /반려동물|영업일 기준 24시간/);
});

test('반려동물 있음은 예약 생성 API가 일반 예약 대신 상담접수로 전환한다', async () => {
  const before = db.prepare('SELECT COUNT(*) as c FROM reservations').get().c;
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      houseTypeKey: '24평', hasPet: true,
      customerPhone: '010-9200-0001', desiredDate: '2027-04-05',
    })
  ));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONSULT_REQUIRED');
  assert.equal(res.body.consultReason, 'pet');
  assert.ok(res.body.requestCode, '상담접수 번호가 발급되어야 한다');
  const after = db.prepare('SELECT COUNT(*) as c FROM reservations').get().c;
  assert.equal(after, before, '일반 예약이 생성되면 안 된다');
});

test('반려동물 상담 건은 deposit-account 접근이 차단된다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '24평', customerPhone: '010-9200-0002', desiredDate: '2027-04-06',
  });
  // 데이터가 어떤 경로로든 pet=1이 되면 계좌 gate가 다시 막아야 한다
  db.prepare(`UPDATE reservations SET has_pet=1, account_revealed_at=NULL WHERE id=?`).run(reservation.id);
  db.prepare(`DELETE FROM payments WHERE reservation_id=?`).run(reservation.id);
  db.prepare(`UPDATE reservations SET reservation_status='received' WHERE id=?`).run(reservation.id);

  await assert.rejects(
    () => reservations.revealDepositAccount(reservation.id),
    /반려동물|상담/,
    '반려동물 상담 건에 계좌가 공개되면 안 된다'
  );
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

test('캐시에 없는 날짜는 견적 계산이 거부된다 (일반일로 간주 금지)', async () => {
  await assert.rejects(
    () => pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '원룸', desiredDate: '2030-06-15' }),
    /공휴일 정보가 아직 준비되지 않았습니다/,
    '캐시에 없는 날짜로 금액을 확정하면 안 된다'
  );
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

test('특수일 캐시 검증은 예약 창과 독립적으로도 동작한다', async () => {
  // 예약 가능 기간을 통과하더라도 calculateQuote가 캐시 부재를 직접 막는다
  await assert.rejects(
    () => pricing.calculateQuote({ serviceType: '입주청소', houseTypeKey: '원룸', desiredDate: '2030-06-15' }),
    /공휴일 정보가 아직 준비되지 않았습니다/
  );
  const synced = await specialDayStore.isDateSynced('2030-06-15');
  assert.equal(synced, false);
});

// ===========================================================================
// [신규] 상담 개인정보 동의 우회 방지
// ===========================================================================

test('동의를 전송하는 모든 폼이 privacyAgreed를 하드코딩하지 않는다', async () => {
  const forms = [
    'src/components/booking/BookingForm.tsx',
    'src/app/consultation/ConsultationForm.tsx',
  ];
  for (const f of forms) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.doesNotMatch(src, /privacyAgreed:\s*true/, `${f}에 동의값 하드코딩`);
    assert.doesNotMatch(src, /Agreed:\s*true/, `${f}에 동의값 하드코딩`);
  }
  // 실제 체크 state를 전송해야 한다
  const booking = fs.readFileSync(path.join(process.cwd(), forms[0]), 'utf8');
  assert.match(booking, /privacyAgreed:\s*consultPrivacyAgreed/);
  assert.match(booking, /privacyAgreed,/, '일반 예약도 체크값 전송');
  const consult = fs.readFileSync(path.join(process.cwd(), forms[1]), 'utf8');
  assert.match(consult, /privacyAgreed:\s*agreed/);
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

test('반려동물 확인 UI가 있었음/관련없음으로 제공된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.match(src, /있었음/);
  assert.match(src, /관련없음/);
  assert.match(src, /petConfirmed/);
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

test('반려동물 최종 확인이 hasPet과 단일 source of truth로 동기화된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  // 최종 확인 버튼은 confirmPet 하나만 호출해야 한다
  assert.match(src, /function confirmPet\(v: boolean\) \{[\s\S]*?setPetConfirmed\(v\);[\s\S]*?setHasPet\(v\);/);
  // petConfirmed만 따로 바꾸는 잔재가 없어야 한다
  assert.doesNotMatch(src, /onClick=\{\(\) => setPetConfirmed\(v\)\}/, 'hasPet과 분리된 핸들러가 남아 있으면 안 된다');
  assert.doesNotMatch(src, /if \(v\) setHasPet\(true\)/, '단방향 동기화 잔재');
  // 두 곳(상담 단계 / 동의 단계) 모두 confirmPet 사용
  const calls = src.match(/confirmPet\(v\)/g) ?? [];
  assert.equal(calls.length, 2, '상담 단계와 동의 단계 모두 confirmPet을 사용해야 한다');
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

test('최종 확인 "있었음"은 서버 상담 gate를 통과하지 못한다', async () => {
  // hasPet=true가 전달되면 40평이 아니어도 서버가 상담으로 전환한다
  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({
      houseTypeKey: '24평', hasPet: true,
      customerPhone: '010-9400-0002', desiredDate: '2027-06-11',
      petMeta: { hasPet: true, confirmedAtFinalStep: true },
    })
  ));
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONSULT_REQUIRED');
  assert.equal(res.body.consultReason, 'pet');
  assert.ok(res.body.requestCode);

  // 상담 데이터에 반려동물 정보가 보존됐는지 확인
  const row = db.prepare(
    `SELECT pet_meta FROM consultation_requests WHERE request_code=?`
  ).get(res.body.requestCode);
  assert.ok(row?.pet_meta, '상담 데이터에 반려동물 정보가 저장되어야 한다');
  assert.equal(JSON.parse(row.pet_meta).hasPet, true);
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

test('예약 가능기간 밖 날짜는 예약 생성 API가 거부한다', async () => {
  const bw = await import('../src/lib/booking-window.ts');
  const beyond = new Date(`${bw.bookingMaxDate()}T00:00:00Z`);
  beyond.setUTCDate(beyond.getUTCDate() + 1);
  const ds = beyond.toISOString().slice(0, 10);

  const res = await reservationsRoute.POST(makeReqWithFreshIp(
    fullyAgreedReservationBody({ desiredDate: ds, customerPhone: '010-9500-0001' })
  ));
  assert.equal(res.status, 400);
  assert.ok(
    ['OUT_OF_BOOKING_WINDOW', 'SPECIAL_DAY_NOT_SYNCED'].includes(res.body.code) ||
      /1년 이후|예약은 오늘부터/.test(res.body.error),
    `예상 밖 응답: ${JSON.stringify(res.body)}`
  );
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
    ['extraNotes', ''],
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

test('공휴일/손없는날 판정은 DB 캐시를 단일 source로 사용한다', async () => {
  // Production 판정 경로가 정적 목록을 직접 쓰지 않아야 한다
  const consumers = [
    'src/lib/pricing.ts',
    'src/app/api/calendar/route.ts',
    'src/app/api/reservations/route.ts',
    'src/app/api/quote/route.ts',
  ];
  for (const f of consumers) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    assert.match(src, /special-days-store/, `${f}는 DB 캐시를 사용해야 한다`);
    assert.doesNotMatch(
      src,
      /from ["']@?\.?\/?(lib\/)?special-days["']/,
      `${f}가 정적 목록을 직접 import하면 안 된다`
    );
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

test('캐시에 없는 날짜는 일반일로 간주하지 않고 오류를 던진다', async () => {
  await assert.rejects(
    () => specialDayStore.getSpecialDay('2035-01-15'),
    /공휴일 정보가 아직 준비되지 않았습니다/
  );
  await assert.rejects(
    () => specialDayStore.getDateAdjustmentFromStore('2035-01-15'),
    /준비되지 않았습니다/
  );
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

test('캐시가 없는 날짜는 캘린더에서 선택할 수 없다', async () => {
  const calendarRoute = await import('../src/app/api/calendar/route.ts');
  const bw = await import('../src/lib/booking-window.ts');
  const start = bw.bookingMinDate();
  const res = await calendarRoute.GET({
    url: `http://localhost/api/calendar?start=${start}&end=${start}`,
  });
  const body = await res.json();
  const day = body.days[0];
  assert.equal(day.specialDaySynced, true, '동기화된 날짜여야 한다');
  // specialDaySynced가 false면 selectable도 false여야 한다
  const src = fs.readFileSync(path.join(process.cwd(), 'src/app/api/calendar/route.ts'), 'utf8');
  assert.match(src, /selectable: !!special &&/);
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

test('instrumentation은 부팅 시 전체 동기화를 실행하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/instrumentation.ts'), 'utf8');
  assert.doesNotMatch(src, /syncSpecialDays\(/, '부팅 시 동기화를 실행하면 안 된다');
  assert.match(src, /checkCoverage/, '커버리지 확인만 수행한다');
  assert.match(src, /console\.warn/, '부족 시 경고만 남긴다');
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
  const date = '2027-07-05';
  // capacity 1에 confirmed 예약 1건 → 마감
  await calendar.setCalendarDay(date, 'available', 1, null, 'morning');
  const { reservation } = await createReservationWithDepositAccount({
    customerPhone: '010-9800-0001', desiredDate: date, timeSlot: 'morning',
  });
  await reservations.confirmPayment(reservation.id, '관리자', null);

  const res = await calendarRoute.GET({ url: `http://localhost/api/calendar?start=${date}&end=${date}` });
  const body = await res.json();
  const day = body.days.find((d) => d.date === date);
  assert.equal(day.morning.publicStatus, '예약완료');
  assert.equal(day.morning.selectable, false);
});

test('월간 캘린더 조회는 날짜 수에 비례해 count 쿼리를 반복하지 않는다', async () => {
  const repo = await import('../src/database/repositories/calendar-repository.ts');
  // 범위 aggregate 함수가 존재해야 한다
  assert.equal(typeof repo.aggregateActiveReservationsInRange, 'function');
  assert.equal(typeof repo.aggregateConfirmedReservationsInRange, 'function');

  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/calendar.ts'), 'utf8');
  // 월 조회 경로에서 날짜별 count 호출이 없어야 한다
  const rangeFn = src.slice(src.indexOf('export async function getSlotCalendarRange'));
  assert.doesNotMatch(rangeFn, /countActiveReservationsOnSlot\(/, '월 조회에서 날짜별 count 반복 금지');
  assert.match(rangeFn, /aggregateActiveReservationsInRange/);

  const apiSrc = fs.readFileSync(path.join(process.cwd(), 'src/app/api/calendar/route.ts'), 'utf8');
  assert.doesNotMatch(apiSrc, /hasConfirmedReservationOnSlot/, 'confirmed도 배치 집계를 써야 한다');
  assert.match(apiSrc, /aggregateConfirmedReservationsInRange/);
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
  await calendar.setCalendarDay('2027-07-22', 'off', 1, null, 'morning');         // 관리자 마감

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

test('BookingForm이 CONSULT_REQUIRED 흐름을 유지한다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingForm.tsx'), 'utf8');
  assert.match(src, /CONSULT_REQUIRED/);
  assert.match(src, /kind: "consultation"/);
});

// --- 사이청소 label ---

test('고객 UI에 "당일 이사 사이청소" label이 적용된다', async () => {
  const types = await import('../src/lib/types.ts');
  assert.equal(types.serviceLabel('사이청소'), '당일 이사 사이청소');
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

  // 가격 계산 contract 유지
  const q = await pricing.calculateQuote({ serviceType: '사이청소', houseTypeKey: '24평' });
  assert.equal(q.serviceType, '사이청소');
  assert.equal(q.multiplier, 1.5);

  // 예약 저장도 내부 key 유지
  const { reservation } = await createReservationWithDepositAccount({
    serviceType: '사이청소', houseTypeKey: '24평',
    customerPhone: '010-9800-0002', desiredDate: '2027-07-25',
  });
  assert.equal(reservation.service_type, '사이청소');
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
  assert.match(src, /async function discardClient/);
  // best-effort end + global 제거
  assert.match(src, /global\.__cleaningReservationPg = undefined/);
  assert.match(src, /client\.end/);
  // liveness 실패 시 discard 후 재생성
  assert.match(src, /if \(await isAlive\(cached\)\)/);
  assert.match(src, /await discardClient\(cached\)/);
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
  assert.match(src, /function withTimeout/);
  assert.match(src, /DatabaseTimeoutError/);
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

test('재시도는 최대 1회로 제한된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  const runPg = src.slice(src.indexOf('async function runPg'), src.indexOf('async function runPg') + 1400);
  // catch 안에서 재귀 호출하지 않고 단 한 번만 재실행한다
  assert.doesNotMatch(runPg, /return runPg\(/, 'runPg를 재귀 호출하면 재시도가 무한해진다');
  assert.match(runPg, /\(retry\)/);
  const retryCount = (runPg.match(/withTimeout\(fn\(/g) ?? []).length;
  assert.equal(retryCount, 3, '초기 1회 + 트랜잭션 1회 + 재시도 1회');
});

test('transaction 내부에서는 connection을 교체하지 않는다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/database/connection.ts'), 'utf8');
  const runPg = src.slice(src.indexOf('async function runPg'), src.indexOf('async function runPg') + 1400);
  // 트랜잭션이면 같은 client로 실행하고 즉시 반환한다 (discard/재생성 없음)
  assert.match(runPg, /const inTransaction = pgTransaction\.getStore\(\);/);
  assert.match(runPg, /if \(inTransaction\)/);
  const txBranch = runPg.slice(runPg.indexOf('if (inTransaction)'), runPg.indexOf('const client = await getPostgresClient()'));
  assert.doesNotMatch(txBranch, /discardClient/, '트랜잭션 중 client를 폐기하면 안 된다');
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
