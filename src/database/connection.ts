import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseBackend = "sqlite" | "postgres";

export function getDatabaseBackend(): DatabaseBackend {
  if (process.env.DATABASE_URL) return "postgres";
  if (process.env.DATABASE_PATH) return "sqlite";
  return process.env.NODE_ENV === "production" ? "postgres" : "sqlite";
}

function resolveDbPath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  return path.join(process.cwd(), ".local-data", "cleaning-reservation.db");
}

export const DB_PATH = resolveDbPath();

function ensureParentDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

declare global {
  var __cleaningReservationDb: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __cleaningReservationPg: unknown | undefined;
}

let _sqliteInitialized = false;

function initSqlite(): DatabaseSync {
  if (global.__cleaningReservationDb) return global.__cleaningReservationDb;
  ensureParentDir(DB_PATH);
  const conn = new DatabaseSync(DB_PATH);
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
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
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
