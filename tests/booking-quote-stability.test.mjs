import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'src/components/booking/BookingForm.tsx'), 'utf8');

test('고객 연락처 입력만으로 이미 발급된 견적을 다시 요청하지 않는다', () => {
  const effect = source.match(/\/\/ 최신 견적 요청만 화면 상태를 갱신한다\.[\s\S]*?return \(\) => \{[\s\S]*?\};\n  \}, \[([^\]]+)\]\);/)?.[1]
    ?? source.match(/\/\/ 최신 견적 요청만 화면 상태를 갱신한다\.[\s\S]*?return \(\) => controller\.abort\(\);\n  \}, \[([^\]]+)\]\);/)?.[1]
    ?? '';
  assert.ok(effect, '견적 useEffect dependency를 찾을 수 있어야 한다');
  assert.doesNotMatch(effect, /customerPhone/);
});

test('쿠폰 적용 시에는 현재 연락처를 견적 요청에 포함한다', () => {
  assert.match(source, /couponCode: appliedCoupon \|\| undefined,[\s\S]*customerPhone: customerPhone \|\| undefined/);
  assert.match(source, /\bappliedCoupon\b/);
});

test('일시적인 견적 통신 실패는 자동 재시도하고 고객을 마지막 단계에 고립시키지 않는다', () => {
  assert.match(source, /QUOTE_MAX_AUTO_RETRIES/);
  assert.match(source, /QUOTE_RECOVERY_RETRY_DELAY_MS/);
  assert.match(source, /loadQuote\(attempt \+ 1\)/);
  assert.match(source, /loadQuote\(0\)/);
  assert.match(source, /retryTimer/);
});

test('성공한 견적 토큰은 같은 가격 조건에서는 유지하고 가격 조건이 바뀔 때만 교체한다', () => {
  assert.match(source, /successfulQuoteKeyRef/);
  assert.match(source, /quoteRequestKey/);
  assert.match(source, /successfulQuoteKeyRef\.current !== quoteRequestKey/);
  assert.match(source, /successfulQuoteKeyRef\.current = quoteRequestKey/);
});
