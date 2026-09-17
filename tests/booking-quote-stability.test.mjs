import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/components/booking/BookingForm.tsx'), 'utf8');

test('고객 연락처 입력만으로 이미 발급된 견적을 다시 요청하지 않는다', () => {
  const effect = source.match(/\/\/ 최신 견적 요청만 화면 상태를 갱신한다\.[\s\S]*?return \(\) => controller\.abort\(\);\n  \}, \[([^\]]+)\]\);/)?.[1] ?? '';
  assert.ok(effect, '견적 useEffect dependency를 찾을 수 있어야 한다');
  assert.doesNotMatch(effect, /customerPhone/);
});

test('쿠폰 적용 시에는 현재 연락처를 견적 요청에 포함한다', () => {
  assert.match(source, /couponCode: appliedCoupon \|\| undefined,[\s\S]*customerPhone: customerPhone \|\| undefined/);
  assert.match(source, /\bappliedCoupon\b/);
});
