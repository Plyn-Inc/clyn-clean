import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/quote-token.ts'), 'utf8');

test('production quote token can derive a dedicated key from JWT_SECRET when QUOTE_TOKEN_SECRET is absent', () => {
  assert.match(source, /QUOTE_TOKEN_SECRET/);
  assert.match(source, /JWT_SECRET/);
  assert.match(source, /clyn-quote-token-v1/);
  assert.match(source, /createHmac\("sha256", jwt\)/);
});
