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
};

const pgTransaction = new AsyncLocalStorage<PostgresClient>();

async function getPostgresClient(): Promise<PostgresClient> {
  if (global.__cleaningReservationPg) {
    return global.__cleaningReservationPg as PostgresClient;
  }
  const mod = await import("postgres");
  const postgres = mod.default;
  const client = postgres(postgresUrl(), {
    // Vercel serverless에서는 인스턴스마다 별도 pool이 생기므로
    // 인스턴스당 1개 연결만 유지해 Supabase 연결 수 고갈을 방지한다.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Supabase transaction pooler는 prepared statement를 지원하지 않는다
    prepare: false,
  }) as unknown as PostgresClient;
  global.__cleaningReservationPg = client;
  return client;
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
  const client = pgTransaction.getStore() ?? await getPostgresClient();
  return (await client.unsafe(toPostgresSql(sql), params)).map((row) => normalizePostgresRow(row) as T);
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
  const client = pgTransaction.getStore() ?? await getPostgresClient();
  await client.unsafe(toPostgresSql(sql), params);
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
  const client = pgTransaction.getStore() ?? await getPostgresClient();
  const result = await client.unsafe(toPostgresSql(sql), params);
  // postgres.js는 결과 배열에 count 속성으로 영향 행 수를 제공한다
  return Number((result as unknown as { count?: number }).count ?? 0);
}

export async function insertReturningId(sql: string, params: unknown[] = []): Promise<number> {
  if (getDatabaseBackend() === "sqlite") {
    const result = getDb().prepare(sql).run(...(params as import("node:sqlite").SQLInputValue[]));
    return Number(result.lastInsertRowid);
  }
  const client = pgTransaction.getStore() ?? await getPostgresClient();
  const rows = await client.unsafe(`${toPostgresSql(sql)} RETURNING id`, params);
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
