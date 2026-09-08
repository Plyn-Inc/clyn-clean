import bcrypt from "bcryptjs";
import * as adminRepo from "./repositories/admin-repository";

export async function seedAdmin(): Promise<void> {
  if ((await adminRepo.countAll()) > 0) return;

  const username = process.env.ADMIN_DEFAULT_USERNAME;
  const password = process.env.ADMIN_DEFAULT_PASSWORD;
  const name = process.env.ADMIN_DEFAULT_NAME || "관리자";

  if (!username || !password) {
    console.warn(
      "\n[moving-clean] 관리자 계정이 아직 없고 ADMIN_DEFAULT_USERNAME / ADMIN_DEFAULT_PASSWORD가 설정되지 않았습니다."
    );
    return;
  }

  if (password.length < 10) {
    console.warn("\n[moving-clean] ADMIN_DEFAULT_PASSWORD는 10자 이상을 권장합니다.\n");
  }

  const hash = bcrypt.hashSync(password, 10);
  await adminRepo.insert(username, hash, name, true);
  console.log(`[moving-clean] 초기 관리자 계정이 생성되었습니다. (ID: ${username})`);
}
