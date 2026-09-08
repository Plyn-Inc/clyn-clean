import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import * as adminRepo from "@/database/repositories/admin-repository";
import { getJwtSecret } from "./jwt-config";

export interface AdminSession {
  adminId: number;
  username: string;
  name: string;
  mustChangePassword: boolean;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

export function getAdminByUsername(username: string) {
  return adminRepo.findByUsername(username);
}

export function countAdmins(): Promise<number> {
  return adminRepo.countAll();
}

export async function createAdmin(username: string, password: string, name: string, mustChangePassword = false) {
  const hash = bcrypt.hashSync(password, 10);
  await adminRepo.insert(username, hash, name, mustChangePassword);
}

export async function changeAdminPassword(adminId: number, newPassword: string) {
  const hash = bcrypt.hashSync(newPassword, 10);
  await adminRepo.updatePassword(adminId, hash);
}

export async function verifyAdminPassword(username: string, password: string) {
  const admin = await adminRepo.findByUsername(username);
  if (!admin) return null;
  const valid = bcrypt.compareSync(password, admin.password_hash);
  return valid ? admin : null;
}

export async function createSessionToken(session: AdminSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as AdminSession;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = "moving_clean_admin_session";
