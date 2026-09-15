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

test('견적 API는 슬롯 가용성 DB 재조회 없이 예약경로/슬롯으로 할인 후보만 판정한다', () => {
  const route = read('src/app/api/quote/route.ts');
  assert.doesNotMatch(route, /computeInstantDiscountEligible/);
  assert.match(route, /isInstantDiscountCandidate/);
  assert.match(route, /isInstantDiscountCandidate\(entryRoute, timeSlot\)/);
});

test('추가옵션이 없으면 견적 API는 option_prices를 조회하지 않는다', () => {
  const route = read('src/app/api/quote/route.ts');
  assert.match(route, /if \(\(extraOptions\?\.length \?\? 0\) > 0\)/);
  const optionBlock = between(route, 'if ((extraOptions?.length ?? 0) > 0) {', 'const quote = await calculateQuote');
  assert.match(optionBlock, /getOptionPrices\(\)/);
});

test('최종 예약 API도 할인 판정을 위해 캘린더 DB를 중복 조회하지 않는다', () => {
  const route = read('src/app/api/reservations/route.ts');
  assert.doesNotMatch(route, /computeInstantDiscountEligible/);
  assert.match(route, /isInstantDiscountCandidate/);
  assert.doesNotMatch(route, /countAreas/);
});

test('DB 연결 계열 실패는 generic 500이 아니라 식별 가능한 503으로 반환한다', () => {
  const route = read('src/app/api/reservations/route.ts');
  const errors = read('src/lib/error-messages.ts');
  assert.match(route, /isConnectionError/);
  assert.match(route, /code: "DB_UNAVAILABLE"/);
  assert.match(errors, /DB_UNAVAILABLE:/);
});

test('예약 생성 직후 존재하지 않는 payment를 다시 조회하지 않는다', () => {
  const reservations = read('src/lib/reservations.ts');
  const createBlock = between(reservations, 'export async function createReservation(', '// ---------------------------------------------------------------------------\n// 조회');
  assert.doesNotMatch(createBlock, /findPaymentByReservationId/);
  assert.match(createBlock, /return \{ reservation, payment: null \}/);
});

test('계좌 공개 API는 cron으로 분리된 만료예약 전체 정리를 고객 요청에서 실행하지 않는다', () => {
  const route = read('src/app/api/reservations/[code]/deposit-account/route.ts');
  assert.doesNotMatch(route, /releaseExpiredDepositReservations/);
});

test('계좌 공개는 예약 생성 당시 가격 snapshot을 신뢰하고 가격표를 다시 계산하지 않는다', () => {
  const reservations = read('src/lib/reservations.ts');
  const reveal = between(reservations, 'export async function revealDepositAccount(', 'export async function confirmPayment(');
  assert.doesNotMatch(reveal, /calculateQuote\(/);
  assert.match(reveal, /price_confirmed_snapshot/);
});

test('고객은 확인 단계에서 전체 주소를 보고 바로 주소 수정으로 1단계에 이동할 수 있다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const step4 = between(form, '{step === 4 && (', '{error &&');
  assert.match(step4, /label="작업 장소"/);
  assert.match(step4, /address\.trim\(\)/);
  assert.match(step4, /주소 수정/);
  assert.match(step4, /setStep\(1\)/);
});

test('견적 API는 DB 연결/timeout을 generic 500 대신 503 코드로 반환한다', () => {
  const route = read('src/app/api/quote/route.ts');
  assert.match(route, /DatabaseTimeoutError/);
  assert.match(route, /isConnectionError/);
  assert.match(route, /code: "DB_TIMEOUT"/);
  assert.match(route, /code: "DB_UNAVAILABLE"/);
});

test('계좌 공개 API도 DB 연결/timeout을 식별 가능한 503으로 반환한다', () => {
  const route = read('src/app/api/reservations/[code]/deposit-account/route.ts');
  assert.match(route, /DatabaseTimeoutError/);
  assert.match(route, /isConnectionError/);
  assert.match(route, /code: "DB_TIMEOUT"/);
  assert.match(route, /code: "DB_UNAVAILABLE"/);
});

test('서비스지역 master 준비상태와 ON 여부는 예약 제출에서 DB 한 번으로 확인한다', () => {
  const route = read('src/app/api/reservations/route.ts');
  const repo = read('src/database/repositories/region-repository.ts');
  assert.match(route, /getReservationAreaStatus/);
  assert.doesNotMatch(route, /countAreas/);
  assert.match(route, /masterReady[^]*REGION_MASTER_NOT_READY/);
  assert.match(repo, /export async function getReservationAreaStatus/);
  const block = between(repo, 'export async function getReservationAreaStatus', '/** 활성 서비스 지역 코드 집합 */');
  assert.equal((block.match(/queryRow</g) ?? []).length, 1);
  assert.match(block, /administrative_areas/);
  assert.match(block, /service_areas/);
});
