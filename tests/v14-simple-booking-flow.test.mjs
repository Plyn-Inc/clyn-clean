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

test('예약 제출 API는 가격/지역/캘린더를 서버에서 다시 계산하지 않는다', () => {
  const route = read('src/app/api/reservations/route.ts');
  const post = between(route, 'export async function POST', 'export async function GET');
  assert.doesNotMatch(post, /calculateQuote\(/);
  assert.doesNotMatch(post, /getReservationAreaStatus/);
  assert.doesNotMatch(post, /getOptionPrices\(/);
  assert.match(post, /clientQuote/);
});

test('예약 생성 핵심은 슬롯/견적/준비상태 DB 재검증 없이 저장한다', () => {
  const src = read('src/lib/reservations.ts');
  const block = between(src, 'export async function createReservationAndDeposit(', '// ---------------------------------------------------------------------------\n// 조회');
  assert.doesNotMatch(block, /checkReservationReadiness/);
  assert.doesNotMatch(block, /getDaySlotView/);
  assert.doesNotMatch(block, /lockReservationSlot/);
  assert.doesNotMatch(block, /calculateQuote\(/);
  assert.match(block, /insertReservation/);
  assert.match(block, /insertPayment/);
  assert.match(block, /insertLog/);
});

test('예약 POST 성공 응답에 입금계좌 안내정보가 바로 포함된다', () => {
  const route = read('src/app/api/reservations/route.ts');
  assert.match(route, /depositInfo/);
  assert.match(route, /accountNumber/);
  assert.match(route, /status:\s*201/);
});

test('고객 폼은 예약 성공 뒤 deposit-account API를 다시 호출하지 않는다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const submit = between(form, 'async function submitReservation()', 'if (result?.kind === "deposit")');
  assert.doesNotMatch(submit, /deposit-account/);
  assert.match(submit, /depositInfo/);
  assert.match(submit, /clientQuote/);
});

test('확인단계 주소 수정은 1단계 이동이 아니라 인라인 입력으로 처리한다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const step4 = between(form, '{step === 4 && (', '{error &&');
  assert.match(form, /addressEditing/);
  assert.match(step4, /주소 수정/);
  assert.match(step4, /상세 주소/);
  assert.doesNotMatch(step4, /setStep\(1\)/);
});

test('입금 확인은 최종 확정이 아니라 관리자 최종확정 대기로 전이한다', () => {
  const src = read('src/lib/reservations.ts');
  const block = between(src, 'export async function confirmPayment(', '/**\n * 관리자 최종 예약확정.');
  assert.match(block, /awaiting_admin_check/);
  assert.doesNotMatch(block, /\? "confirmed"/);
  assert.doesNotMatch(block, /nextStatus[^;]*"confirmed"/);
});

test('관리자 최종확정은 캘린더를 다시 계산하지 않고 상태와 입금만 확인한다', () => {
  const src = read('src/lib/reservations.ts');
  const block = between(src, 'export async function confirmReservation(', 'const ALLOWED_PAYMENT_TRANSITIONS');
  assert.doesNotMatch(block, /getDaySlotView/);
  assert.doesNotMatch(block, /countActiveReservationsOnSlotExcluding/);
  assert.match(block, /setReservationStatusRaw\(reservationId, "confirmed"\)/);
});

test('관리자 최종확정 버튼은 입금확인 + awaiting_admin_check에서만 활성화된다', () => {
  const page = read('src/app/admin/(protected)/reservations/[id]/page.tsx');
  assert.match(page, /payment\?\.payment_status !== "confirmed"/);
  assert.match(page, /reservation\?\.reservation_status !== "awaiting_admin_check"/);
  assert.match(page, /confirm-reservation/);
});

test('공개 캘린더는 복합 calendar helper와 DB 특수일 조회를 사용하지 않는다', () => {
  const route = read('src/app/api/calendar/route.ts');
  assert.doesNotMatch(route, /getSlotCalendarRange/);
  assert.doesNotMatch(route, /getSpecialDayRange/);
  assert.doesNotMatch(route, /aggregateConfirmedReservationsInRange/);
  assert.match(route, /findRange/);
  assert.match(route, /aggregatePublicReservationStatesInRange/);
});

test('공개 캘린더 예약 상태는 단일 집계 쿼리에서 active/confirmed를 함께 계산한다', () => {
  const repo = read('src/database/repositories/calendar-repository.ts');
  const block = between(repo, 'export async function aggregatePublicReservationStatesInRange(', '// ---------------------------------------------------------------------------\n// 사이청소');
  assert.match(block, /active_count/);
  assert.match(block, /confirmed_count/);
  assert.equal((block.match(/queryRows</g) ?? []).length, 1);
});

test('고객 캘린더 범례는 세 상태만 유지한다', () => {
  const src = read('src/components/booking/ReservationCalendar.tsx');
  const legend = between(src, '{/* 범례 — 3종 공개상태 */}', '</div>\n    </div>');
  assert.match(legend, /예약가능/);
  assert.match(legend, /예약진행 중/);
  assert.match(legend, /예약완료/);
  assert.doesNotMatch(legend, /토요일|일요일|공휴일|손없는날/);
});
