import { execute, queryRow, queryRows } from "../connection";

export async function findValue(key: string): Promise<string | undefined> {
  return (await queryRow<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]))?.value;
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
