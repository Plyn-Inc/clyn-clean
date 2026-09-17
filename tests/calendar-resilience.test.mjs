import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('공개 캘린더는 상태 API 실패 시에도 달력 구조를 숨기지 않는다', () => {
  const source = read('src/components/booking/StableReservationCalendar.tsx');
  assert.doesNotMatch(source, /status === "error" \?\s*\(\s*<div[^>]*>[^]*다시 불러오기/s);
  assert.match(source, /상태를 확인하지 못했습니다/);
});

test('캘린더 상태 조회는 사용자 버튼 없이 자동 재시도한다', () => {
  const source = read('src/components/booking/StableReservationCalendar.tsx');
  assert.match(source, /MAX_AUTO_RETRIES/);
  assert.match(source, /setTimeout/);
  assert.doesNotMatch(source, />\s*다시 불러오기\s*</);
});

test('BookingSection은 안정형 캘린더를 사용한다', () => {
  const source = read('src/components/booking/BookingSection.tsx');
  assert.match(source, /StableReservationCalendar/);
});
