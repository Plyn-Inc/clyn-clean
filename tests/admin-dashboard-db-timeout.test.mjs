import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('Supabase shared transaction-pooler URLs are normalized to session mode for postgres.js', () => {
  const connection = read('src/database/connection.ts');

  assert.match(connection, /function normalizePostgresUrlForPostgresJs\(/);
  assert.match(connection, /pooler\.supabase\.com/);
  assert.match(connection, /url\.port === ["']6543["']/);
  assert.match(connection, /url\.port = ["']5432["']/);
  assert.match(connection, /normalizePostgresUrlForPostgresJs\(value\)/);
});

test('admin dashboard recent reservations are limited in SQL instead of fetching all rows then slicing', () => {
  const repo = read('src/database/repositories/reservation-repository.ts');
  const service = read('src/lib/reservations.ts');
  const page = read('src/app/admin/(protected)/dashboard/page.tsx');

  assert.match(repo, /export function listRecentReservationsWithPayment\(limit = 8\)/);
  assert.match(repo, /ORDER BY r\.created_at DESC LIMIT \?/);
  assert.match(service, /export function listRecentReservations\(limit = 8\)/);
  assert.match(page, /listRecentReservations\(8\)/);
  assert.doesNotMatch(page, /listReservations\(\)\)\.slice\(0, 8\)/);
});
