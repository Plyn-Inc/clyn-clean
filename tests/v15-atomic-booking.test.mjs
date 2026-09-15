import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('PostgreSQL 고객 예약은 명시적 BEGIN 대신 단일 atomic statement를 사용한다', () => {
  const reservations = read('src/lib/reservations.ts');
  const repo = read('src/database/repositories/reservation-repository.ts');

  assert.match(repo, /export async function insertReservationBundlePostgres/);
  assert.match(repo, /WITH inserted_reservation AS/i);
  assert.match(repo, /inserted_payment AS/i);
  assert.match(repo, /inserted_log AS/i);

  const start = reservations.indexOf('export async function createReservationAndDeposit');
  const end = reservations.indexOf('// ---------------------------------------------------------------------------\n// 조회', start);
  const fn = reservations.slice(start, end);
  assert.match(fn, /getDatabaseBackend\(\) === "postgres"/);
  assert.match(fn, /insertReservationBundlePostgres/);
});

test('PostgreSQL atomic booking은 예약, pending payment, 관리자 이력을 같은 statement에 기록한다', () => {
  const repo = read('src/database/repositories/reservation-repository.ts');
  const start = repo.indexOf('export async function insertReservationBundlePostgres');
  const fn = repo.slice(start, start + 9000);

  assert.match(fn, /INSERT INTO reservations/i);
  assert.match(fn, /INSERT INTO payments/i);
  assert.match(fn, /'manual_bank_transfer'/);
  assert.match(fn, /'pending'/);
  assert.match(fn, /INSERT INTO confirmation_logs/i);
  assert.match(fn, /reservation_received/);
  assert.match(fn, /awaiting_deposit/);
});
