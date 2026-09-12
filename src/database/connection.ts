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

type PostgresClient = {
  unsafe: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  begin: <T>(fn: (sql: PostgresClient) => Promise<T>) => Promise<T>;
  end?: (options?: { timeout?: number }) => Promise<void>;
};

const pgTransaction = new AsyncLocalStorage<PostgresClient>();

// ---------------------------------------------------------------------------
// Vercel serverless stale connection 대응
//
// 문제: 인스턴스가 freeze/resume되면 global에 보존된 postgres-js client의
//       소켓이 죽어 있는데도 재사용되어, Supavisor 쪽에서 ClientRead 상태로
//       무한 대기(RSC 렌더 suspend)가 발생한다.
//
// 대응: 캐시된 client를 쓰기 전에 짧은 liveness check(SELECT 1)를 수행하고,
//       실패하면 client를 폐기 후 재생성한다. 실제 쿼리에도 상한 타임아웃을 둔다.
// ---------------------------------------------------------------------------

/** liveness check(SELECT 1) 타임아웃 */
const LIVENESS_TIMEOUT_MS = 3000;
/** 일반 쿼리 상한 타임아웃 — 무한 대기 방지 */
const QUERY_TIMEOUT_MS = 15000;
/** liveness 재확인 주기 — 매 쿼리마다 SELECT 1을 보내지 않는다 */
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DatabaseTimeoutError(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * connection 계열 오류인지 판정한다.
 * SQL validation / constraint / business error는 재시도 대상이 아니다.
 */
export function isConnectionError(e: unknown): boolean {
  if (e instanceof DatabaseTimeoutError) return true;
  const err = e as { code?: string; message?: string; errno?: string } | null;
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

/** 죽은 client를 best-effort로 정리한다 */
async function discardClient(client: PostgresClient | undefined): Promise<void> {
  global.__cleaningReservationPg = undefined;
  global.__cleaningReservationPgCheckedAt = undefined;
  if (!client?.end) return;
  try {
    await withTimeout(client.end({ timeout: 1 }), 2000, "client.end");
  } catch {
    // 이미 끊어진 소켓이면 무시한다
  }
}

/** 짧은 liveness check */
async function isAlive(client: PostgresClient): Promise<boolean> {
  try {
    await withTimeout(client.unsafe("SELECT 1"), LIVENESS_TIMEOUT_MS, "liveness check");
    return true;
  } catch {
    return false;
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
    console.warn("[db] stale postgres client 감지 — 폐기 후 재생성합니다.");
    await discardClient(cached);
  }

  const mod = await import("postgres");
  const postgres = mod.default as unknown as (url: string, opts: unknown) => unknown;
  const client = createPostgresClient(postgres);

  if (!(await isAlive(client))) {
    await discardClient(client);
    throw new DatabaseTimeoutError("데이터베이스 연결을 확인하지 못했습니다.");
  }

  global.__cleaningReservationPg = client;
  global.__cleaningReservationPgCheckedAt = Date.now();
  return client;
}

/**
 * PostgreSQL 쿼리 실행 공통 경로.
 *
 * - 트랜잭션 내부에서는 같은 client를 유지하고 재시도하지 않는다.
 * - 트랜잭션 밖에서는 connection 계열 오류에 한해 최대 1회 client recycle + retry.
 * - 모든 쿼리에 상한 타임아웃을 적용해 무한 대기를 막는다.
 */
async function runPg<T>(
  label: string,
  fn: (client: PostgresClient) => Promise<T>
): Promise<T> {
  const inTransaction = pgTransaction.getStore();
  if (inTransaction) {
    // 트랜잭션은 connection 교체 없이 같은 client를 유지한다.
    return withTimeout(fn(inTransaction), QUERY_TIMEOUT_MS, label);
  }

  const client = await getPostgresClient();
  try {
    return await withTimeout(fn(client), QUERY_TIMEOUT_MS, label);
  } catch (e) {
    // SQL/constraint/business error는 재시도하지 않는다
    if (!isConnectionError(e)) throw e;

    console.warn(`[db] ${label} connection 오류 — client를 재생성하고 1회 재시도합니다.`);
    await discardClient(client);
    const fresh = await getPostgresClient();
    // 재시도는 최대 1회. 다시 실패하면 그대로 던진다.
    return withTimeout(fn(fresh), QUERY_TIMEOUT_MS, `${label} (retry)`);
  }
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
  return runPg("queryRows", async (client) =>
    (await client.unsafe(toPostgresSql(sql), params)).map((row) => normalizePostgresRow(row) as T)
  );
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
