import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

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

test('retryable read queries recycle a failed postgres client and retry once', () => {
  const connection = read('src/database/connection.ts');

  assert.match(connection, /export async function queryRowsRetryableRead</);
  const start = connection.indexOf('export async function queryRowsRetryableRead');
  const end = connection.indexOf('\nexport async function queryRow', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = connection.slice(start, end);

  assert.match(block, /isConnectionError\(e\)/);
  assert.match(block, /destroyClient\(/);
  assert.match(block, /return queryRows<T>\(sql, params\)/);
});

test('recent reservation read uses the retryable read path', () => {
  const repo = read('src/database/repositories/reservation-repository.ts');
  const start = repo.indexOf('export function listRecentReservationsWithPayment');
  const end = repo.indexOf('\nexport function ', start + 1);
  assert.notEqual(start, -1);
  const block = repo.slice(start, end === -1 ? undefined : end);

  assert.match(block, /queryRowsRetryableRead/);
});
