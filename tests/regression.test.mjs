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
  '원룸': 179000,
  '원룸 복층': 279000,
  '투룸': 269000,
  '쓰리룸': 319000,
  '18평': 329000,
  '24평': 369000,
  '28평': 420000,
  '32평': 459000,
  '34평': 489000,
  '38평': 539000,
  '40평': 579000,
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
    ...overrides,
  };
}

function makeReq(body) {
  return {
    headers: new Headers(),
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

test('P0-5 40평 이상 미확정 예약은 final_confirmed_total 없이는 최종확정할 수 없다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody({ houseTypeKey: '40평', actualPyeong: 45 }));
  await reservations.confirmPayment(reservation.id, '관리자', null);
  await assert.rejects(
    () => reservations.confirmReservation(reservation.id, '관리자', null),
    /최종.*금액|확정.*금액/
  );
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
  const { reservation } = await reservations.createReservation(validReservationBody());
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

test('P1-4 공개 추가서비스 안내도 활성 옵션 목록만 표시한다', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/components/ExtraOptionsSection.tsx'), 'utf8');
  assert.doesNotMatch(source, /\{EXTRA_OPTIONS\.map\(/);
  assert.match(source, /availableOptions|activeOptions|getOptionPrices|\/api\/quote/);
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

test('40평 이상은 최종금액 입력 후 관리자 최종확정이 가능하다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody({ houseTypeKey: '40평', actualPyeong: 45 }));
  await reservations.confirmPayment(reservation.id, '관리자', null);
  await reservations.updateFinalConfirmedTotal(reservation.id, 680000, '관리자', null);
  await reservations.confirmReservation(reservation.id, '관리자', null);
  const row = db.prepare(`SELECT reservation_status, final_confirmed_total FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(row.reservation_status, 'confirmed');
  assert.equal(row.final_confirmed_total, 680000);
});

test('P1-3 입금확인된 예약은 일반 예약상태 API로 바로 취소할 수 없다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody());
  await reservations.confirmPayment(reservation.id, '관리자', null);
  await assert.rejects(
    () => reservations.updateReservationStatus(reservation.id, 'cancelled', '관리자', null),
    /환불|입금|결제|confirmed/
  );
});

test('P1-3 미입금 예약을 일반 취소하면 pending 결제도 unconfirmed로 정리한다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody());
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
  const first = await reservations.createReservation(validReservationBody({ timeSlot: 'morning' }));
  db.prepare(`UPDATE payments SET payment_due_date=datetime('now','-1 hour') WHERE reservation_id=?`).run(first.reservation.id);
  const second = await reservations.createReservation(validReservationBody({ customerPhone: '010-9999-0003', timeSlot: 'morning' }));
  assert.equal(second.reservation.time_slot, 'morning');
});

test('34평 예약은 선입금 확인 후 자기 슬롯 점유 때문에 최종확정이 막히지 않는다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody({ houseTypeKey: '34평' }));
  await reservations.confirmPayment(reservation.id, '관리자', null);
  await reservations.confirmReservation(reservation.id, '관리자', null);
  assert.equal((await reservations.getReservationById(reservation.id))?.reservation_status, 'confirmed');
});

test('34평 사이청소 snapshot은 기준가/승수/총액/확정여부를 보존한다', async () => {
  const { reservation } = await reservations.createReservation(validReservationBody({ serviceType: '사이청소', houseTypeKey: '34평' }));
  const row = db.prepare(`SELECT * FROM reservations WHERE id=?`).get(reservation.id);
  assert.equal(row.service_type, '사이청소');
  assert.equal(row.house_type_key, '34평');
  assert.equal(row.area_pyeong, 34);
  assert.equal(row.base_price_snapshot, 489000);
  assert.equal(row.price_multiplier, 1.5);
  assert.equal(row.estimated_total_snapshot, 733500);
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
  const { reservation } = await reservations.createReservation(validReservationBody());
  await reservations.confirmPayment(reservation.id, '관리자', null);
  await reservations.confirmReservation(reservation.id, '관리자', null);

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
  assert.equal(res.body.quote.priceConfirmed, false);
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
  const { reservation } = await reservations.createReservation(validReservationBody({ customerPhone: '010-8888-0001' }));
  db.prepare(`UPDATE payments SET payment_due_date=datetime('now','-1 hour') WHERE reservation_id=?`).run(reservation.id);
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
