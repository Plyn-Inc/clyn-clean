import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/booking/BookingSection.tsx'), 'utf8');

test('Hero 예약은 캘린더와 전체 폼을 동시에 세로로 쌓지 않는다', () => {
  assert.match(source, /heroLayout && !hasSelection/);
  assert.match(source, /heroLayout && hasSelection/);
  assert.match(source, /날짜 다시 선택/);
});
