import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function exists(p) {
  return fs.existsSync(path.join(root, p));
}

test('메인은 일반 원룸 OPEN PRICE와 광고형 CTA를 최상단에 노출한다', () => {
  const hero = read('src/components/HeroBanner.tsx');
  assert.match(hero, /원룸 입주·퇴실청소/);
  assert.match(hero, /CLYN OPEN PRICE/);
  assert.match(hero, /OneRoomOfferPrice/);
  assert.match(hero, /예약 가능일 확인/);
  assert.match(hero, /빠른 견적 받기/);
  assert.match(hero, /1\.5룸.*복층.*투룸/s);

  const page = read('src/app/page.tsx');
  assert.match(page, /OneRoomTrustPoints/);
  assert.match(page, /BeforeAfterGallery/);
  assert.match(page, /OneRoomScope/);
  assert.ok(page.indexOf('BeforeAfterGallery') < page.indexOf('ServiceList'), '기타 서비스는 실제 작업 결과보다 뒤에 와야 한다');
});

test('/one-room 광고 랜딩이 일반 원룸 전용 구조와 모바일 CTA를 가진다', () => {
  assert.equal(exists('src/app/one-room/page.tsx'), true);
  const page = read('src/app/one-room/page.tsx');
  assert.match(page, /OneRoomLandingHero/);
  assert.match(page, /BookingSection mode="one-room"/);
  assert.match(page, /일반 단층 원룸/);
  assert.match(page, /원룸 복층/);
  assert.match(page, /MobileStickyCta/);

  const header = read('src/components/SiteHeader.tsx');
  assert.match(header, /usePathname/);
  assert.match(header, /pathname === "\/one-room"/);
});

test('원룸 예약모드는 서비스와 상품만 입주청소/원룸으로 고정하고 별도 구조 확인을 요구하지 않는다', () => {
  const section = read('src/components/booking/BookingSection.tsx');
  assert.match(section, /mode\?: "default" \| "one-room"/);
  assert.match(section, /mode={mode}/);

  const form = read('src/components/booking/BookingForm.tsx');
  assert.match(form, /mode\?: "default" \| "one-room"/);
  assert.match(form, /mode === "one-room"/);
  assert.match(form, /setHouseTypeKey\("원룸"\)/);
  assert.doesNotMatch(form, /oneRoomEligibilityConfirmed/);
  assert.doesNotMatch(form, /일반 단층 원룸 대상 여부를 확인해주세요/);
  assert.doesNotMatch(form, /\[필수 확인\].*1\.5룸·복층·투룸/s);
  assert.match(form, /before_move_in/);
  assert.match(form, /after_move_out/);
});

test('OPEN PRICE는 기존 가격/자동 프로모션 엔진을 이용하는 공개 API에서 온다', () => {
  assert.equal(exists('src/lib/offers.ts'), true);
  assert.equal(exists('src/app/api/offers/one-room/route.ts'), true);
  assert.equal(exists('src/components/OneRoomOfferPrice.tsx'), true);
  const offers = read('src/lib/offers.ts');
  assert.match(offers, /getServiceProductPrice\("입주청소", "원룸"\)/);
  assert.match(offers, /calculateDiscounts/);
  const component = read('src/components/OneRoomOfferPrice.tsx');
  assert.match(component, /\/api\/offers\/one-room/);
  assert.doesNotMatch(component, /139000|139,000/);
});

test('광고 attribution은 예약 snapshot과 PII 없는 marketing_events로 저장된다', () => {
  assert.equal(exists('src/lib/marketing-attribution.ts'), true);
  assert.equal(exists('src/components/MarketingAttributionCapture.tsx'), true);
  assert.equal(exists('src/app/api/marketing/events/route.ts'), true);
  assert.equal(exists('src/database/repositories/marketing-repository.ts'), true);
  assert.equal(exists('supabase/migrations/20260916090000_marketing_attribution.sql'), true);

  const schema = read('src/database/schema.ts');
  for (const field of ['visitor_id', 'first_source', 'first_campaign', 'first_keyword', 'last_source', 'last_campaign', 'last_keyword', 'landing_page', 'first_visit_at']) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(schema, /CREATE TABLE IF NOT EXISTS marketing_events/);

  const route = read('src/app/api/reservations/route.ts');
  assert.match(route, /marketingAttribution/);
  assert.match(route, /booking_completed/);

  const admin = read('src/app/admin/(protected)/reservations/[id]/page.tsx');
  assert.match(admin, /유입정보/);
  assert.match(admin, /first_source/);
  assert.match(admin, /first_campaign/);
});

test('잘못된 광고 attribution은 고객 예약 자체를 막지 않는다', () => {
  const route = read('src/app/api/reservations/route.ts');
  assert.match(route, /marketingAttribution:\s*z\.unknown\(\)\.optional\(\)/);
  assert.match(route, /marketingAttributionSchema\.safeParse\(rawMarketingAttribution\)/);
  assert.match(route, /const saved = await createReservationAndDeposit\(\s*\{\s*\.\.\.reservationData/);
});

test('광고 퍼널은 최초 견적 요청과 예약 완료를 구분해 기록한다', () => {
  const attribution = read('src/lib/marketing-attribution.ts');
  const eventRoute = read('src/app/api/marketing/events/route.ts');
  const form = read('src/components/booking/BookingForm.tsx');
  assert.match(attribution, /"quote_started"/);
  assert.match(eventRoute, /"quote_started"/);
  assert.match(form, /sendMarketingEvent\("quote_started"\)/);
});

// ===========================================================================
// [신규] OPEN PRICE — Admin 프로모션 설정만으로 가격이 결정되는지 검증
//
// 코드에 금액을 박지 않고, discount_promotions 설정에 따라
// 표시가격과 실제 견적이 항상 일치해야 한다.
// ===========================================================================

let db, offers, discounts;

test.before(async () => {
  process.env.QUOTE_TOKEN_SECRET =
    process.env.QUOTE_TOKEN_SECRET || 'one-room-test-secret-must-be-at-least-32-bytes-long';
  await import('../src/database/schema.ts');
  ({ getDb: db } = await import('../src/database/connection.ts'));
  db = db();
  offers = await import('../src/lib/offers.ts');
  discounts = await import('../src/lib/discounts.ts');
});

function clearPromos() {
  db.prepare('DELETE FROM discount_promotions').run();
}
function insertPromo(o = {}) {
  const d = {
    name: '오픈 프로모션', is_active: 1, discount_type: 'fixed', discount_value: 40000,
    starts_at: null, ends_at: null, service_type: null, product_key: null,
    min_amount: 0, max_discount_amount: null, priority: 0, ...o,
  };
  db.prepare(`INSERT INTO discount_promotions
    (name,is_active,discount_type,discount_value,starts_at,ends_at,service_type,product_key,min_amount,max_discount_amount,priority)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    d.name, d.is_active, d.discount_type, d.discount_value, d.starts_at, d.ends_at,
    d.service_type, d.product_key, d.min_amount, d.max_discount_amount, d.priority);
}

const ONE_ROOM_BASE = 179000;

test('OPEN PRICE: 금액이 코드에 하드코딩되어 있지 않다', async () => {
  const targets = [
    'src/lib/offers.ts',
    'src/app/api/offers/one-room/route.ts',
    'src/components/OneRoomOfferPrice.tsx',
    'src/components/OneRoomOfferSection.tsx',
    'src/components/OneRoomLandingHero.tsx',
    'src/components/HeroBanner.tsx',
    'src/app/one-room/page.tsx',
  ];
  for (const f of targets) {
    const full = path.join(process.cwd(), f);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    assert.doesNotMatch(src, /139[,_]?000/, `${f}에 금액을 하드코딩하면 안 된다`);
    assert.doesNotMatch(src, /179[,_]?000/, `${f}에 정상가를 하드코딩하면 안 된다`);
  }
});

test('OPEN PRICE: 프로모션 40,000원이면 139,000원이 된다', async () => {
  clearPromos();
  insertPromo({ discount_value: 40000 });
  const offer = await offers.getOneRoomOffer();
  assert.equal(offer.basePrice, ONE_ROOM_BASE);
  assert.equal(offer.discountAmount, 40000);
  assert.equal(offer.openPrice, 139000, '운영 목표가는 Admin 설정만으로 달성된다');
});

test('OPEN PRICE: 표시가격과 실제 견적이 항상 일치한다', async () => {
  for (const [type, value, expected] of [
    ['fixed', 40000, 139000],
    ['fixed', 20000, 159000],
    ['percent', 20, ONE_ROOM_BASE - Math.floor(ONE_ROOM_BASE * 0.2)],
  ]) {
    clearPromos();
    insertPromo({ discount_type: type, discount_value: value });

    const offer = await offers.getOneRoomOffer();
    const quote = await discounts.calculateDiscounts({
      serviceType: '입주청소', productKey: '원룸', originalAmount: ONE_ROOM_BASE,
    });
    assert.equal(offer.openPrice, expected, `${type} ${value} 표시가`);
    assert.equal(offer.openPrice, quote.finalAmount, `${type} ${value}: 표시가 == 실제 견적`);
  }
});

test('OPEN PRICE: 프로모션이 없으면 정상가가 노출된다', async () => {
  clearPromos();
  const offer = await offers.getOneRoomOffer();
  assert.equal(offer.openPrice, ONE_ROOM_BASE);
  assert.equal(offer.discountAmount, 0);
  assert.equal(offer.promotionName, null);
});

test('OPEN PRICE: 비활성/기간 밖 프로모션은 적용되지 않는다', async () => {
  for (const over of [
    { is_active: 0 },
    { ends_at: '2000-01-01T00:00:00.000Z' },
    { starts_at: '2099-01-01T00:00:00.000Z' },
  ]) {
    clearPromos();
    insertPromo({ discount_value: 40000, ...over });
    const offer = await offers.getOneRoomOffer();
    assert.equal(offer.openPrice, ONE_ROOM_BASE, `${JSON.stringify(over)} 미적용`);
    assert.equal(offer.discountAmount, 0);
  }
});

test('OPEN PRICE: 프로모션이 여러 개면 가장 큰 할인 1개만 적용된다', async () => {
  clearPromos();
  insertPromo({ name: '작은', discount_value: 5000 });
  insertPromo({ name: '오픈 프로모션', discount_value: 40000 });
  insertPromo({ name: '중간', discount_value: 15000 });
  const offer = await offers.getOneRoomOffer();
  assert.equal(offer.discountAmount, 40000);
  assert.equal(offer.promotionName, '오픈 프로모션');
  assert.equal(offer.openPrice, 139000, '중첩 적용되면 안 된다');
});

test('OPEN PRICE: 원룸 상품이 비활성이면 offer를 만들지 않는다', async () => {
  clearPromos();
  const orig = db.prepare(`SELECT is_active FROM price_rules WHERE service_type='입주청소' AND product_key='원룸'`).get().is_active;
  try {
    db.prepare(`UPDATE price_rules SET is_active=0 WHERE service_type='입주청소' AND product_key='원룸'`).run();
    const offer = await offers.getOneRoomOffer();
    assert.equal(offer, null, '임의 가격을 만들지 않는다');
  } finally {
    db.prepare(`UPDATE price_rules SET is_active=? WHERE service_type='입주청소' AND product_key='원룸'`).run(orig);
  }
});

test('OPEN PRICE: 가격 조회 실패 시 화면이 안전한 문구로 대체된다', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OneRoomOfferPrice.tsx'), 'utf8');
  // 실패해도 0원이나 임의 금액을 표시하지 않는다
  assert.match(src, /예약에서 최종 가격 확인/, '실패 시 대체 문구가 있어야 한다');
  assert.doesNotMatch(src, /0원|139,000/, '실패 시 임의 금액을 표시하면 안 된다');
  assert.match(src, /setFailed\(true\)/);
});

test('OPEN PRICE: 원룸 상품 기본가를 바꾸면 표시가도 따라간다', async () => {
  clearPromos();
  insertPromo({ discount_value: 40000 });
  const orig = db.prepare(`SELECT base_price FROM price_rules WHERE service_type='입주청소' AND product_key='원룸'`).get().base_price;
  try {
    db.prepare(`UPDATE price_rules SET base_price=199000 WHERE service_type='입주청소' AND product_key='원룸'`).run();
    const offer = await offers.getOneRoomOffer();
    assert.equal(offer.basePrice, 199000);
    assert.equal(offer.openPrice, 159000, '기본가 변경이 표시가에 반영된다');
  } finally {
    db.prepare(`UPDATE price_rules SET base_price=? WHERE service_type='입주청소' AND product_key='원룸'`).run(orig);
  }
});
