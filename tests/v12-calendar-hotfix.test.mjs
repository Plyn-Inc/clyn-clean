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

test('고객 캘린더 하단 범례는 공개 예약상태 3개만 노출한다', () => {
  const src = read('src/components/booking/ReservationCalendar.tsx');
  const legend = between(src, '{/* 범례 — 3종 공개상태 */}', 'function Legend');

  assert.equal((legend.match(/<Legend /g) ?? []).length, 3, '하단 범례 항목은 정확히 3개여야 한다');
  assert.match(legend, /label="예약가능"/);
  assert.match(legend, /label="예약진행 중"/);
  assert.match(legend, /label="예약완료"/);
  assert.doesNotMatch(legend, /<span|일요일|공휴일|토요일|손없는날/);
});

test('사이청소 재개방 override 조회 실패만으로 월 캘린더 전체가 실패하지 않는다', () => {
  const src = read('src/lib/calendar.ts');
  assert.match(src, /async function safeFindReopenOverride/);
  assert.match(src, /async function safeFindReopenOverridesInRange/);
  assert.match(src, /findReopenOverride\(date, timeSlot\)/);
  assert.match(src, /safeFindReopenOverride\(date, timeSlot\)/);
  assert.match(src, /findReopenOverridesInRange\(startDate, endDate\)/);
  assert.match(src, /return new Map\(\)/);
  assert.match(src, /safeFindReopenOverridesInRange\(startDate, endDate\)/);
});

test('공개 캘린더는 DB 특수일 보조 조회를 제거하고 정적 특별일 데이터만 사용한다', () => {
  const src = read('src/app/api/calendar/route.ts');
  assert.doesNotMatch(src, /getSpecialDayRange/);
  assert.doesNotMatch(src, /safeSpecialDayRange/);
  assert.match(src, /getStaticSpecialDayMeta/);
});

test('공개 캘린더는 진행/완료 상태를 한 번의 예약 집계로 가져온다', () => {
  const src = read('src/app/api/calendar/route.ts');
  assert.doesNotMatch(src, /aggregateConfirmedReservationsInRange/);
  assert.match(src, /aggregatePublicReservationStatesInRange/);
});

test('PostgreSQL 콜드스타트 동시 쿼리는 클라이언트 초기화를 한 번만 공유한다', () => {
  const src = read('src/database/connection.ts');
  assert.match(src, /__cleaningReservationPgInitPromise/);
  assert.match(src, /if \(global\.__cleaningReservationPgInitPromise\)/);
  assert.match(src, /global\.__cleaningReservationPgInitPromise = initPromise/);
  assert.match(src, /await initPromise/);
  assert.match(src, /global\.__cleaningReservationPgInitPromise = undefined/);
});
