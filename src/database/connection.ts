import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseBackend = "sqlite" | "postgres";

export function getDatabaseBackend(): DatabaseBackend {
  if (process.env.DATABASE_URL) return "postgres";
  if (process.env.DATABASE_PATH) return "sqlite";
  return process.env.NODE_ENV === "production" ? "postgres" : "sqlite";
}

/**
 * SQLite 파일 경로를 결정한다.
 *
 * 반드시 lazy 호출해야 한다 — 모듈 최상위에서 호출하면 import만으로
 * 파일시스템에 디렉터리를 만들게 되어, Vercel serverless(/var/task 읽기 전용)에서
 * `ENOENT: mkdir '/var/task/.local-data'` 오류가 발생한다.
 *
 * PostgreSQL 모드에서는 호출되어서는 안 된다.
 */
function resolveDbPath(): string {
  if (getDatabaseBackend() === "postgres") {
    throw new Error(
      "[clyn-clean] PostgreSQL 모드에서 SQLite 경로를 확인하려 했습니다. " +
        "DATABASE_URL이 설정된 환경에서는 SQLite 파일을 사용하지 않습니다."
    );
  }
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  // 로컬/테스트 환경에서만 .local-data를 생성한다 (이 함수가 실제 호출될 때).
  const devDir = path.join(process.cwd(), ".local-data");
  if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true });
  return path.join(devDir, "cleaning-reservation.db");
}

/**
 * SQLite DB 파일 경로. 기존 `DB_PATH` 상수를 대체한다.
 * 모듈 로드 시점이 아니라 호출 시점에 평가된다.
 */
export function getDbPath(): string {
  return resolveDbPath();
}

function ensureParentDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

declare global {
  var __cleaningReservationDb: DatabaseSync | undefined;
  var __cleaningReservationPg: unknown | undefined;
}

let _sqliteInitialized = false;

function initSqlite(): DatabaseSync {
  if (global.__cleaningReservationDb) return global.__cleaningReservationDb;
  const dbPath = getDbPath();
  ensureParentDir(dbPath);
  // node:sqlite는 lazy load — PostgreSQL 모드에서는 로드조차 하지 않는다.
  // ESM/CJS 양쪽에서 동작하도록 createRequire 사용.
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync: SqliteCtor } = nodeRequire("node:sqlite");
  const conn = new SqliteCtor(dbPath) as DatabaseSync;
  conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec("PRAGMA foreign_keys = ON;");
  global.__cleaningReservationDb = conn;
  return conn;
}

/** SQLite 전용 동기 연결. 테스트/로컬 개발 및 schema seed에서만 사용합니다. */
export function getDb(): DatabaseSync {
  if (getDatabaseBackend() !== "sqlite") {
    throw new Error("getDb() is SQLite-only. Use async query helpers for PostgreSQL.");
  }
  const conn = initSqlite();
  if (!_sqliteInitialized) {
    _sqliteInitialized = true;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("./schema");
  }
  return conn;
}

function postgresUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error("DATABASE_URL is required when using PostgreSQL.");
  }
  return value;
}

/**
 * postgres-js PendingQuery — .execute()로 즉시 전송하고 .cancel()로 중단할 수 있다.
 * (postgres-js 3.4.x)
 */
type PendingQuery = Promise<Record<string, unknown>[]> & {
  execute: () => PendingQuery;
  cancel: () => void;
};

type PostgresClient = {
  unsafe: (query: string, params?: unknown[]) => PendingQuery;
  begin: <T>(fn: (sql: PostgresClient) => Promise<T>) => Promise<T>;
  end?: (options?: { timeout?: number }) => Promise<void>;
};

const pgTransaction = new AsyncLocalStorage<PostgresClient>();

// ---------------------------------------------------------------------------
// Vercel serverless stale connection / orphan query 대응
//
// 문제 1: 인스턴스 freeze/resume 후 global에 보존된 client의 소켓이 죽어 있는데도
//         재사용되어 Supavisor에서 ClientRead 무한 대기가 발생한다.
// 문제 2: Promise.race만으로 timeout을 걸면 JS promise만 먼저 실패하고
//         실제 postgres query는 DB에서 계속 실행되어 orphan으로 남는다.
//
// 대응:
//   - 캐시된 client는 사용 전 짧은 liveness check(SELECT 1)로 확인
//   - 모든 쿼리는 PendingQuery 핸들을 보존하고, timeout 시 .cancel()을 호출해
//     실제 postgres query를 중단시킨다
//   - cancel 후 grace period 안에 settle되지 않으면 client를 destroy하고
//     global cache에서 제거해 다음 요청이 stale socket을 재사용하지 않게 한다
// ---------------------------------------------------------------------------

/** liveness check(SELECT 1) 타임아웃 */
const LIVENESS_TIMEOUT_MS = 3000;
/** 일반 쿼리 상한 타임아웃 */
const QUERY_TIMEOUT_MS = 8000;
/** cancel 요청 후 query가 settle되기를 기다리는 시간 */
const CANCEL_GRACE_MS = 2000;
/** liveness 재확인 주기 */
const LIVENESS_CACHE_MS = 5000;

declare global {
  var __cleaningReservationPgCheckedAt: number | undefined;
}

export class DatabaseTimeoutError extends Error {
  code = "DB_TIMEOUT";
  constructor(message: string) {
    super(message);
    this.name = "DatabaseTimeoutError";
  }
}

/** 연결 수립 자체가 실패한 경우 — query가 DB에 전달되지 않았다고 판단할 수 있다 */
export class DatabaseConnectError extends Error {
  code = "DB_CONNECT_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConnectError";
  }
}

// --- 최소 timing log (SQL/파라미터/PII/접속정보는 로그하지 않는다) ---------
function logOk(op: string, ms: number) {
  if (ms >= 1000) console.warn(`[db] query:slow ${op} ${ms}ms`);
}
function logTimeout(op: string, ms: number) {
  console.warn(`[db] query:timeout ${op} ${ms}ms`);
}
function logRecycle(reason: string) {
  console.warn(`[db] client:recycle ${reason}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * connection 계열 오류인지 판정한다.
 * SQL validation / constraint / business error는 재시도 대상이 아니다.
 */
export function isConnectionError(e: unknown): boolean {
  if (e instanceof DatabaseTimeoutError) return true;
  if (e instanceof DatabaseConnectError) return true;
  const err = e as { code?: string; message?: string } | null;
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "");
  const connCodes = [
    "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH",
    "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT",
    "08000", "08003", "08006", "08001", "08004", "57P01", "57P02", "57P03",
  ];
  if (connCodes.includes(code)) return true;
  return /ECONNRESET|EPIPE|ETIMEDOUT|socket|connection (closed|ended|terminated|reset)|timed out/i.test(msg);
}

/**
 * "query가 DB에 전달되지 않았다"고 판단 가능한 연결 실패인지.
 * 이 경우에만 재시도를 허용한다. 실행 여부가 불확실한 timeout은 제외한다.
 */
export function isRetriableConnectError(e: unknown): boolean {
  if (e instanceof DatabaseConnectError) return true;
  const err = e as { code?: string; message?: string } | null;
  const code = String(err?.code ?? "");
  return ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "CONNECT_TIMEOUT"].includes(code);
}

function createPostgresClient(postgres: (url: string, opts: unknown) => unknown): PostgresClient {
  return postgres(postgresUrl(), {
    // Vercel serverless에서는 인스턴스마다 별도 pool이 생기므로
    // 인스턴스당 1개 연결만 유지해 Supabase 연결 수 고갈을 방지한다.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase transaction pooler는 prepared statement를 지원하지 않는다
    prepare: false,
    // Supabase는 TLS를 요구한다
    ssl: "require",
  }) as unknown as PostgresClient;
}

/**
 * client를 destroy하고 global cache에서 제거한다.
 * timeout: 0 → pending query를 즉시 reject하고 소켓을 파괴한다.
 */
async function destroyClient(client: PostgresClient | undefined, reason: string): Promise<void> {
  global.__cleaningReservationPg = undefined;
  global.__cleaningReservationPgCheckedAt = undefined;
  logRecycle(reason);
  if (!client?.end) return;
  try {
    await Promise.race([client.end({ timeout: 0 }), sleep(2000)]);
  } catch {
    // 이미 끊어진 소켓이면 무시한다
  }
}

/**
 * 쿼리를 실행하고, timeout 시 실제 postgres query를 cancel한다.
 *
 * Promise.race만 쓰지 않는다. timeout이 나면
 *   1) PendingQuery.cancel()로 DB 쪽 실행을 중단 요청
 *   2) grace period 동안 실제 settle 여부를 확인
 *   3) settle되지 않으면 client를 destroy (orphan query 방지)
 *
 * cancel은 별도 protocol connection을 쓰므로 성공이 보장되지 않는다.
 * 따라서 cancel 호출만으로 종료됐다고 가정하지 않고 반드시 settle을 확인한다.
 */
async function execWithCancel(
  client: PostgresClient,
  op: string,
  build: (c: PostgresClient) => PendingQuery
): Promise<Record<string, unknown>[]> {
  const started = Date.now();
  // .execute()로 즉시 전송하고 핸들을 보존한다 (cancel 대상)
  const handle = build(client).execute();

  let settled = false;
  const tracked = handle.then(
    (v) => { settled = true; return v; },
    (e) => { settled = true; throw e; }
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DatabaseTimeoutError(`${op} timed out after ${QUERY_TIMEOUT_MS}ms`)),
      QUERY_TIMEOUT_MS
    );
  });

  try {
    const rows = await Promise.race([tracked, timeout]);
    logOk(op, Date.now() - started);
    return rows;
  } catch (e) {
    if (!(e instanceof DatabaseTimeoutError)) throw e;

    logTimeout(op, QUERY_TIMEOUT_MS);
    // 1) 실제 postgres query 중단 요청
    try { handle.cancel(); } catch { /* cancel 자체 실패는 무시 */ }

    // 2) grace period 동안 실제 settle 확인
    await Promise.race([tracked.catch(() => undefined), sleep(CANCEL_GRACE_MS)]);

    // 3) settle되지 않았으면 orphan query가 남는다 → client destroy
    if (!settled) {
      await destroyClient(client, "cancel-not-settled");
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    // 핸들이 나중에 reject되어도 unhandled rejection이 되지 않게 한다
    void tracked.catch(() => undefined);
  }
}

/** 짧은 liveness check */
async function isAlive(client: PostgresClient): Promise<boolean> {
  const handle = client.unsafe("SELECT 1").execute();
  let settled = false;
  const tracked = handle.then(
    (v) => { settled = true; return v; },
    (e) => { settled = true; throw e; }
  );
  try {
    await Promise.race([
      tracked,
      sleep(LIVENESS_TIMEOUT_MS).then(() => { throw new DatabaseTimeoutError("liveness timeout"); }),
    ]);
    return true;
  } catch {
    if (!settled) {
      try { handle.cancel(); } catch { /* noop */ }
    }
    return false;
  } finally {
    void tracked.catch(() => undefined);
  }
}

async function getPostgresClient(): Promise<PostgresClient> {
  const cached = global.__cleaningReservationPg as PostgresClient | undefined;

  if (cached) {
    // 최근에 확인했으면 매번 SELECT 1을 보내지 않는다
    const checkedAt = global.__cleaningReservationPgCheckedAt ?? 0;
    if (Date.now() - checkedAt < LIVENESS_CACHE_MS) return cached;

    if (await isAlive(cached)) {
      global.__cleaningReservationPgCheckedAt = Date.now();
      return cached;
    }
    // stale socket — 그대로 재사용하면 무한 대기가 발생한다
    await destroyClient(cached, "stale-connection");
  }

  const mod = await import("postgres");
  const postgres = mod.default as unknown as (url: string, opts: unknown) => unknown;
  const client = createPostgresClient(postgres);

  if (!(await isAlive(client))) {
    await destroyClient(client, "new-client-unreachable");
    // 연결 수립 실패 — query가 DB에 전달되지 않았다
    throw new DatabaseConnectError("데이터베이스에 연결하지 못했습니다.");
  }

  global.__cleaningReservationPg = client;
  global.__cleaningReservationPgCheckedAt = Date.now();
  return client;
}

/**
 * PostgreSQL 쿼리 실행 공통 경로.
 *
 * - 트랜잭션 내부: 같은 client를 유지하고 재시도하지 않는다.
 *   timeout 시 cancel 후 에러를 던져 상위 transaction이 rollback되게 한다.
 * - 트랜잭션 밖: 연결 수립 실패(query 미전달 확정)에만 최대 1회 재시도.
 *   timeout된 query는 실행 여부가 불확실하므로 재시도하지 않는다
 *   (중복 예약/중복 상담 생성 방지).
 */
async function runPg(
  op: string,
  build: (c: PostgresClient) => PendingQuery
): Promise<Record<string, unknown>[]> {
  const inTransaction = pgTransaction.getStore();
  if (inTransaction) {
    // 트랜잭션은 connection 교체 없이 같은 client를 유지한다.
    // timeout이면 cancel 후 throw → 상위 begin()이 rollback한다.
    return execWithCancel(inTransaction, op, build);
  }

  let client: PostgresClient;
  try {
    client = await getPostgresClient();
  } catch (e) {
    // 연결 수립 실패는 query가 전달되지 않았음이 확정이므로 1회만 재시도한다
    if (!isRetriableConnectError(e)) throw e;
    await destroyClient(global.__cleaningReservationPg as PostgresClient | undefined, "connect-retry");
    client = await getPostgresClient();
  }

  // timeout된 query는 자동 재시도하지 않는다 (write 중복 방지).
  return execWithCancel(client, op, build);
}

/**
 * Repository SQL은 SQLite 스타일 `?` placeholder를 사용합니다.
 * PostgreSQL 실행 시 `$1`, `$2` 형식과 CURRENT_TIMESTAMP로 변환합니다.
 */
export function toPostgresSql(sql: string): string {
  let index = 0;
  return sql
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bLIKE\b/gi, "ILIKE")
    .replace(/\?/g, () => `$${++index}`);
}

export function normalizePostgresRow<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const entries = Object.entries(row as Record<string, unknown>).map(([key, value]) => [
    key,
    value instanceof Date ? value.toISOString() : value,
  ]);
  return Object.fromEntries(entries) as T;
}

export async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (getDatabaseBackend() === "sqlite") {
    return getDb().prepare(sql).all(...(params as import("node:sqlite").SQLInputValue[])) as T[];
  }
  const rows = await runPg("queryRows", (client) => client.unsafe(toPostgresSql(sql), params));
  return rows.map((row) => normalizePostgresRow(row) as T);
}

export async function queryRow<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await queryRows<T>(sql, params);
  return rows[0];
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  if (getDatabaseBackend() === "sqlite") {
    getDb().prepare(sql).run(...(params as import("node:sqlite").SQLInputValue[]));
    return;
  }
  await runPg("execute", (client) => client.unsafe(toPostgresSql(sql), params));
}

/**
 * 조건부 atomic update용 — 실제로 변경된 행 수를 반환한다.
 *
 * 동시성 방어에 사용한다. 예:
 *   UPDATE reservations SET ... WHERE id = ? AND reservation_status = 'approved_awaiting_deposit'
 * 반환값이 0이면 그 사이 다른 트랜잭션이 상태를 바꾼 것이므로 호출부가 중단해야 한다.
 *
 * SQLite/PostgreSQL 양쪽에서 동일한 의미를 보장한다.
 */
export async function executeReturningCount(sql: string, params: unknown[] = []): Promise<number> {
  if (getDatabaseBackend() === "sqlite") {
    const result = getDb().prepare(sql).run(...(params as import("node:sqlite").SQLInputValue[]));
    return Number(result.changes ?? 0);
  }
  const result = await runPg("executeReturningCount", (client) =>
    client.unsafe(toPostgresSql(sql), params)
  );
  // postgres.js는 결과 배열에 count 속성으로 영향 행 수를 제공한다
  return Number((result as unknown as { count?: number }).count ?? 0);
}

export async function insertReturningId(sql: string, params: unknown[] = []): Promise<number> {
  if (getDatabaseBackend() === "sqlite") {
    const result = getDb().prepare(sql).run(...(params as import("node:sqlite").SQLInputValue[]));
    return Number(result.lastInsertRowid);
  }
  const rows = await runPg("insertReturningId", (client) =>
    client.unsafe(`${toPostgresSql(sql)} RETURNING id`, params)
  );
  const id = rows[0]?.id;
  if (typeof id !== "number" && typeof id !== "bigint" && typeof id !== "string") {
    throw new Error("INSERT did not return an id.");
  }
  return Number(id);
}

export async function lockReservationSlot(date: string, timeSlot: string): Promise<void> {
  if (getDatabaseBackend() === "sqlite") return;
  // PostgreSQL advisory transaction lock: the same date/slot is serialized
  // across concurrent Vercel instances until the surrounding transaction ends.
  await queryRows(
    "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
    [`clyn-clean:reservation-slot:${date}:${timeSlot}`]
  );
}

export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (getDatabaseBackend() === "sqlite") {
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const client = await getPostgresClient();
  return client.begin(async (tx) => pgTransaction.run(tx, fn));
}

export function asRow<T>(value: unknown): T | undefined {
  return value as T | undefined;
}

export function asRows<T>(value: unknown): T[] {
  return value as T[];
}

export function asParams(value: object): Record<string, import("node:sqlite").SQLInputValue> {
  return value as Record<string, import("node:sqlite").SQLInputValue>;
}
