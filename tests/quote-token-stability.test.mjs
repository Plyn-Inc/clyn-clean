import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/components/booking/BookingForm.tsx'), 'utf8');

test('전화번호 입력은 일반 견적 재요청 조건이 아니다', () => {
  const dependencyMatch = source.match(/\}, \[regionReadyForPricing,[^\]]+\]\);/s);
  assert.ok(dependencyMatch, '견적 effect dependency 배열을 찾을 수 있어야 한다');
  assert.doesNotMatch(dependencyMatch[0], /customerPhone/);
});

test('쿠폰 재견적 시에는 현재 전화번호를 서버에 전달한다', () => {
  assert.match(source, /couponCode: appliedCoupon \|\| undefined,/);
  assert.match(source, /customerPhone: customerPhone \|\| undefined,/);
});
