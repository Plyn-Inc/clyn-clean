import { execute, queryRow, queryRows } from "../connection";

export async function findValue(key: string): Promise<string | undefined> {
  return (await queryRow<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]))?.value;
}

/**
 * 여러 key를 한 번의 SELECT로 조회한다 (N round-trip 제거).
 *
 * 홈페이지 회사정보처럼 여러 설정을 함께 읽는 경로에서
 * key 개수만큼 순차 쿼리를 보내지 않도록 한다.
 */
export async function findValues(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await queryRows<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
    keys
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function findAll(): Promise<{ key: string; value: string }[]> {
  return queryRows<{ key: string; value: string }>("SELECT key, value FROM settings");
}

export function upsertValue(key: string, value: string): Promise<void> {
  return execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value]
  );
}
