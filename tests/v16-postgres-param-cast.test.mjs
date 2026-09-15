import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/database/repositories/reservation-repository.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function insertReservationBundlePostgres');
const end = source.indexOf('\nexport function setReservationStatusRaw', start);
const fn = source.slice(start, end);

test('PostgreSQL atomic booking gives agreementVersion parameter an explicit text type', () => {
  assert.ok(start >= 0 && end > start, 'insertReservationBundlePostgres function must exist');
  assert.match(
    fn,
    /CASE WHEN \?::text IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END/,
    'agreementVersion null-check must cast the bind parameter to text to avoid PostgreSQL 42P18'
  );
  assert.doesNotMatch(
    fn,
    /CASE WHEN \? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END/,
    'PostgreSQL atomic booking must not use an untyped bind parameter in IS NOT NULL'
  );
});
