import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('고객 노출 서비스명은 사이청소로 표시한다', () => {
  const src = read('src/lib/types.ts');
  assert.match(src, /"사이청소":\s*"사이청소"/);
  assert.doesNotMatch(src, /"사이청소":\s*"당일 이사 사이청소"/);
});

test('고객 예약 캘린더는 화면에 표시한 월과 같은 월을 API에 요청한다', () => {
  const src = read('src/components/booking/ReservationCalendar.tsx');
  assert.match(src, /getMonthRangeKST\(cursor\.year,\s*cursor\.month\)/);
  assert.doesNotMatch(src, /getMonthRangeKST\(cursor\.year,\s*cursor\.month\s*\+\s*1\)/);
});

test('공개 캘린더는 정적 특수일 표시는 하되 예약 가능 여부를 특수일 동기화에 의존하지 않는다', () => {
  const src = read('src/app/api/calendar/route.ts');
  assert.match(src, /getStaticSpecialDayMeta/);
  assert.match(src, /isStaticSpecialDaySupported/);
  assert.doesNotMatch(src, /getSpecialDayRange/);
  assert.match(src, /selectable:\s*adminStatus === "available" && remaining > 0/);
});

test('예약 생성도 특수일 캐시 미동기화만으로 거부하지 않는다', () => {
  const src = read('src/app/api/reservations/route.ts');
  assert.doesNotMatch(src, /if\s*\(\s*!\(await isDateSynced\(dateStr\)\)\s*\)/);
});

test('특수일 캐시 장애 시 지원 연도는 내장 특별일 표로 가격 판정을 보완한다', () => {
  const src = read('src/lib/special-days-store.ts');
  assert.match(src, /staticYearSupported\(dateStr\)/);
  assert.match(src, /const\s+fallback\s*=\s*staticMeta\(dateStr\)/);
});
