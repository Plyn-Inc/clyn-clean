import { execute, insertReturningId, queryRow } from "../connection";

export interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  must_change_password: number;
  created_at: string;
}

export function findByUsername(username: string): Promise<AdminRow | undefined> {
  return queryRow<AdminRow>("SELECT * FROM admins WHERE username = ?", [username]);
}

export function findById(id: number): Promise<AdminRow | undefined> {
  return queryRow<AdminRow>("SELECT * FROM admins WHERE id = ?", [id]);
}

export async function countAll(): Promise<number> {
  const row = await queryRow<{ c: number | string }>("SELECT COUNT(*) as c FROM admins");
  return Number(row?.c ?? 0);
}

export async function insert(username: string, passwordHash: string, name: string, mustChangePassword: boolean) {
  return insertReturningId(
    "INSERT INTO admins (username, password_hash, name, must_change_password) VALUES (?, ?, ?, ?)",
    [username, passwordHash, name, mustChangePassword ? 1 : 0]
  );
}

export function updatePassword(id: number, passwordHash: string): Promise<void> {
  return execute(
    "UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?",
    [passwordHash, id]
  );
}
