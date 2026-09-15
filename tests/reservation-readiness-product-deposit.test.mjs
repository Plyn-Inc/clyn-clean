import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('예약 준비 검사는 상품별 예약금을 쓰므로 전역 deposit_amount를 요구하지 않는다', () => {
  const settings = read('src/lib/settings.ts');
  const block = settings.match(/export async function checkReservationReadiness\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(block, /getPricingSettings/);
  assert.doesNotMatch(block, /pricing\.depositAmount/);
  assert.match(block, /getBankSettings/);
  assert.match(block, /입금 은행명/);
  assert.match(block, /입금 계좌번호/);
  assert.match(block, /예금주/);
  assert.match(block, /입금 기한/);
});
