import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sectionSource = fs.readFileSync(path.join(root, 'src/components/booking/BookingSection.tsx'), 'utf8');
const formSource = fs.readFileSync(path.join(root, 'src/components/booking/BookingForm.tsx'), 'utf8');

test('Hero 예약은 캘린더와 전체 폼을 동시에 세로로 쌓지 않는다', () => {
  assert.match(sectionSource, /heroLayout && !hasSelection/);
  assert.match(sectionSource, /heroLayout && hasSelection/);
  assert.match(sectionSource, /날짜 다시 선택/);
});

test('원룸 Hero에서 날짜 선택 후 폼 마운트가 부모 날짜 선택을 지우지 않는다', () => {
  const oneRoomEffect = formSource.match(/useEffect\(\(\) => \{\s*if \(mode !== "one-room"\) return;[^]*?\}, \[mode\]\);/);
  assert.ok(oneRoomEffect, '원룸 초기화 effect를 찾을 수 있어야 한다');
  assert.doesNotMatch(oneRoomEffect[0], /onServiceChange\?\.\("입주청소"\)/);
});
