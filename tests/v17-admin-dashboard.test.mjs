import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(a, -1, `start marker not found: ${start}`);
  assert.notEqual(b, -1, `end marker not found: ${end}`);
  return source.slice(a, b);
}

test('admin dashboard stats are fetched with one aggregate database query', () => {
  const repo = read('src/database/repositories/reservation-repository.ts');
  assert.match(repo, /export async function getDashboardStatsAggregate\(/);
  const block = between(repo, 'export async function getDashboardStatsAggregate(', '\nexport async function countByStatus');
  assert.equal((block.match(/queryRow</g) ?? []).length, 1);
  assert.match(block, /COUNT\(\*\).*total/s);
  assert.match(block, /awaiting_deposit/);
  assert.match(block, /confirmed/);
  assert.match(block, /consult_required/);
});

test('admin dashboard does not launch seven concurrent database queries', () => {
  const reservations = read('src/lib/reservations.ts');
  const block = between(reservations, 'export async function getDashboardStats()', '// ---------------------------------------------------------------------------\n// 입금기한');
  assert.doesNotMatch(block, /Promise\.all/);
  assert.match(block, /getDashboardStatsAggregate\(\)/);
});

test('admin dashboard page loads stats and recent reservations sequentially', () => {
  const page = read('src/app/admin/(protected)/dashboard/page.tsx');
  assert.doesNotMatch(page, /Promise\.all/);
  assert.match(page, /const stats = await getDashboardStats\(\);[\s\S]*const recent = \(await listReservations\(\)\)/);
});
