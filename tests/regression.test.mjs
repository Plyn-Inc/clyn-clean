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
let reservations;
let priceRulesRoute;
let quoteRoute;
let reservationsRoute;
let paymentStatusRoute;
let reservationStatusRoute;

const CANONICAL_PRICES = {
  '원룸': 169000,
  '원룸 복층': 219000,
  '1.5룸': 229000,
  '투룸': 249000,
  '쓰리룸': 299000,
  '18평': 309000,
  '24평': 339000,
  '28평': 389000,
  '32평': 419000,
  '34평': 449000,
  '38평': 490000,
  '40평': 529000,
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

// [정책 변경] 40평 이상 529,000원은 정식 가격표 상품이 되었다.
// 관리자 별도견적 입력 없이 고객이 계좌 단계까지 진행할 수 있어야 한다.
test('P0-5 40평 이상은 정식 가격표 상품이므로 별도견적 없이 계좌 단계까지 진행된다', async () => {
  const { reservation, payment } = await createReservationWithDepositAccount({
    houseTypeKey: '40평', actualPyeong: 45, customerPhone: '010-4000-0001', desiredDate: '2026-12-29',
  });
  assert.equal(reservation.reservation_status, 'approved_awaiting_deposit');
  assert.equal(reservation.final_confirmed_total, CANONICAL_PRICES['40평']);
  assert.equal(reservation.deposit_amount_snapshot, EXPECTED_DEPOSITS['40평']);
  assert.ok(payment, '계좌 단계에서 payment가 생성되어야 한다');
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
  assert.match(source, /availableOptions|activeOptions/);
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

// [정책 변경] 40평 이상도 관리자 입금확인만으로 예약완료(confirmed)가 된다.
// 관리자 최종금액 입력은 정식 가격표 밖 특수 케이스에서만 사용한다.
test('40평 이상은 관리자 입금확인으로 예약완료되며 최종금액 snapshot이 보존된다', async () => {
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '40평', actualPyeong: 45, customerPhone: '010-4000-0003', desiredDate: '2026-12-31',
  });
  await reservations.confirmPayment(reservation.id, '관리자', null);
  const row = db.prepare(`SELECT reservation_status, final_confirmed_total, deposit_amount_snapshot, estimated_balance_snapshot FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(row.reservation_status, 'confirmed');
  assert.equal(row.final_confirmed_total, CANONICAL_PRICES['40평']);
  assert.equal(row.deposit_amount_snapshot, EXPECTED_DEPOSITS['40평']);
  // 총금액 = 예약 선금 + 현장 잔금
  assert.equal(row.estimated_balance_snapshot, CANONICAL_PRICES['40평'] - EXPECTED_DEPOSITS['40평']);
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
      // 40평 이상도 529,000원 정식 가격표 상품이므로 확정가로 취급한다
      assert.equal(q.priceConfirmed, true);
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
  assert.equal(res.body.quote.estimatedTotal, 599000);
  // [정책 변경] 40평 이상도 정식 가격표 상품이므로 확정가로 취급한다
  assert.equal(res.body.quote.priceConfirmed, true);
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
  assert.equal(CANONICAL_PRICES['1.5룸'], 229000);

  // 견적 API
  const quote = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '1.5룸', extraOptions: [],
  }));
  assert.equal(quote.status, 200);
  assert.equal(quote.body.quote.basePrice, 229000);
  assert.equal(quote.body.quote.priceConfirmed, true);

  // 예약 + 계좌 단계까지
  const { reservation } = await createReservationWithDepositAccount({
    houseTypeKey: '1.5룸', customerPhone: '010-5000-0001', desiredDate: '2027-01-05',
  });
  assert.equal(reservation.house_type_key, '1.5룸');
  assert.equal(reservation.final_confirmed_total, 229000);
  assert.equal(reservation.deposit_amount_snapshot, 60000);
});

test('홈페이지 견적은 VAT를 자동 가산하지 않는다', async () => {
  const quote = await quoteRoute.POST(makeReq({
    serviceType: '입주청소', houseTypeKey: '32평', extraOptions: [],
  }));
  assert.equal(quote.body.quote.estimatedTotal, 419000);
  // 419,000 * 1.1 = 460,900 — 이 값이 나오면 VAT 자동합산 버그
  assert.notEqual(quote.body.quote.estimatedTotal, 460900);
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
  const total = CANONICAL_PRICES['38평'];
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
  assert.equal(reservation.final_confirmed_total, CANONICAL_PRICES['24평']);
  assert.equal(reservation.deposit_amount_snapshot, EXPECTED_DEPOSITS['24평']);
  assert.equal(
    reservation.estimated_balance_snapshot,
    CANONICAL_PRICES['24평'] - EXPECTED_DEPOSITS['24평']
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
  assert.ok(agreement.CORE_PRINCIPLES.some((p) => p.includes('VAT 별도')));
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
  assert.match(section1.body, /VAT 별도/);
  // 8번 잔금 정산에도 VAT 별도 문구 유지
  const section8 = agreement.AGREEMENT_SECTIONS.find((s) => s.no === 8);
  assert.match(section8.body, /VAT 별도/);
  // 3번 추가요금 항목
  const section3 = agreement.AGREEMENT_SECTIONS.find((s) => s.no === 3);
  assert.match(section3.body, /곰팡이|니코틴|반려동물/);
});
