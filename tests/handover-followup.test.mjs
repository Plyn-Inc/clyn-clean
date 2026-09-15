import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(a, -1, `start marker not found: ${start}`);
  assert.notEqual(b, -1, `end marker not found: ${end}`);
  return source.slice(a, b);
}

test('관리자 서비스지역은 고객용 필터 API가 아니라 전체 행정구역 API를 사용한다', () => {
  const page = read('src/app/admin/(protected)/service-areas/page.tsx');
  const api = read('src/app/api/admin/regions/route.ts');

  assert.match(page, /fetch\("\/api\/admin\/regions"/);
  assert.match(page, /\/api\/admin\/regions\?parent=/);
  assert.doesNotMatch(page, /fetch\("\/api\/regions"/);
  assert.doesNotMatch(page, /`\/api\/regions\?parent=/);

  assert.match(api, /listByLevel/);
  assert.match(api, /listChildren/);
  assert.doesNotMatch(api, /listAvailableSidos|listAvailableChildren/);
});

test('상세주소는 1단계 필수이고 3단계에서는 재입력하지 않는다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const step1 = between(form, '{step === 1 && (', '{step === 2 && (');
  const step3 = between(form, '{step === 3 && (', '{step === 4 && (');
  const validate1 = between(form, 'if (s === 1) {', 'if (s === 2) {');
  const validate3 = between(form, 'if (s === 3) {', 'if (!privacyAgreed)');

  assert.match(step1, /<Field label="상세 주소" required value=\{address\}/);
  assert.match(step1, /선택한 지역/);
  assert.match(validate1, /if \(!address\.trim\(\)\) return "상세 주소를 입력해주세요\.";/);
  assert.doesNotMatch(step3, /<Field label="상세 주소"/);
  assert.doesNotMatch(validate3, /!address\.trim\(\)/);
});

test('공개 캘린더 조회는 만료 예약 정리 같은 쓰기 작업을 수행하지 않는다', () => {
  const api = read('src/app/api/calendar/route.ts');
  assert.doesNotMatch(api, /releaseExpiredDepositReservations/);
  assert.doesNotMatch(api, /입금기한이 지난 예약을 먼저 만료 처리/);
});

test('공개 예약 submit은 서버 견적을 한 번 계산하고 createReservation에 snapshot으로 전달한다', () => {
  const api = read('src/app/api/reservations/route.ts');
  const reservations = read('src/lib/reservations.ts');
  const createBlock = between(reservations, 'export async function createReservation(', 'export async function revealDepositAccount(');

  assert.equal((api.match(/calculateQuote\(/g) ?? []).length, 1);
  assert.match(api, /preparedQuote:\s*serverQuote/);
  assert.match(api, /instantDiscountEligible:\s*eligible/);
  assert.ok((createBlock.match(/calculateQuote\(/g) ?? []).length <= 1, 'createReservation should calculate at most once');
  assert.doesNotMatch(createBlock, /const q2 = await calculateQuote/);
});

test('견적 계산은 관련 settings를 개별 SELECT하지 않고 한 번에 조회한다', () => {
  const pricing = read('src/lib/pricing.ts');
  const calculateBlock = between(pricing, 'export async function calculateQuote(', '// ---------------------------------------------------------------------------\n// 관리자용 CRUD');

  assert.match(pricing, /import \{ getSettings \} from "\.\/settings";/);
  assert.match(calculateBlock, /getSettings\(\[/);
  assert.doesNotMatch(calculateBlock, /getSetting\("deposit_amount"\)/);
  assert.doesNotMatch(calculateBlock, /getSetting\("instant_discount_amount"\)/);
});

test('고객 지역 DB 조회는 서버 데이터 캐시를 재사용하고 관리자 변경 시 해당 tag를 무효화한다', () => {
  const cache = read('src/lib/public-region-cache.ts');
  const api = read('src/app/api/regions/route.ts');
  const admin = read('src/app/api/admin/service-areas/route.ts');
  assert.match(cache, /unstable_cache/);
  assert.match(cache, /PUBLIC_REGION_CACHE_TAG/);
  assert.match(cache, /listAvailableSidos/);
  assert.match(cache, /listAvailableChildren/);
  assert.match(api, /@\/lib\/public-region-cache/);
  assert.match(admin, /revalidateTag\(PUBLIC_REGION_CACHE_TAG/);
});

test('고객 가격표는 서버 데이터 캐시를 재사용하고 관리자 가격 변경 시 무효화한다', () => {
  const cache = read('src/lib/public-pricing-cache.ts');
  const api = read('src/app/api/pricing/route.ts');
  const admin = read('src/app/api/admin/price-rules/route.ts');
  assert.match(cache, /unstable_cache/);
  assert.match(cache, /PUBLIC_PRICING_CACHE_TAG/);
  assert.match(cache, /listPriceRules/);
  assert.match(api, /listCachedPublicPriceRules/);
  assert.match(admin, /revalidateTag\(PUBLIC_PRICING_CACHE_TAG/);
});

test('예약 API는 검증 가격변경 DB timeout을 구분 가능한 오류 코드로 반환한다', () => {
  const api = read('src/app/api/reservations/route.ts');
  const errors = read('src/lib/error-messages.ts');
  assert.match(api, /code: "VALIDATION_ERROR"/);
  assert.match(api, /code: "PRICE_CHANGED"/);
  assert.match(api, /DatabaseTimeoutError/);
  assert.match(api, /code: "DB_TIMEOUT"/);
  assert.match(errors, /PRICE_CHANGED:/);
  assert.match(errors, /VALIDATION_ERROR:/);
  assert.match(errors, /DB_TIMEOUT:/);
});

test('예약 폼 초기 로딩은 today 확인 때문에 예약 API와 DB를 호출하지 않는다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  assert.match(form, /bookingMinDate/);
  assert.doesNotMatch(form, /fetch\("\/api\/reservations"\)/);
  assert.doesNotMatch(form, /setToday/);
});

test('만료 예약 정리는 공개 캘린더와 분리하고 Hobby 호환 일 1회 cron으로 유지한다', () => {
  const cron = read('src/app/api/cron/expired-reservations/route.ts');
  const vercel = read('vercel.json');
  assert.match(cron, /releaseExpiredDepositReservations/);
  assert.match(vercel, /\/api\/cron\/expired-reservations/);
  assert.match(vercel, /"schedule": "0 17 \* \* \*"/);
  assert.doesNotMatch(vercel, /"schedule": "0 \* \* \* \*"/);
});
