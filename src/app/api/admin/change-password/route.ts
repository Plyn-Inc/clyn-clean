import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAdminApiSession } from "@/lib/session";
import { getAdminByUsername, changeAdminPassword, createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const body = await req.json().catch(() => null);
  const currentPassword = body?.currentPassword as string | undefined;
  const newPassword = body?.newPassword as string | undefined;

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "현재 비밀번호와 새 비밀번호를 입력해주세요." }, { status: 400 });
  }
  if (newPassword.length < 10) {
    return NextResponse.json({ error: "새 비밀번호는 10자 이상이어야 합니다." }, { status: 400 });
  }

  const admin = await getAdminByUsername(session.username);
  if (!admin) {
    return NextResponse.json({ error: "관리자 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  const valid = bcrypt.compareSync(currentPassword, admin.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  await changeAdminPassword(admin.id, newPassword);

  // 새 세션 발급 (mustChangePassword = false)
  let token: string;
  try {
    token = await createSessionToken({
      adminId: admin.id,
      username: admin.username,
      name: admin.name,
      mustChangePassword: false,
    });
  } catch (e) {
    console.error("[moving-clean] 세션 재발급 차단:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "비밀번호는 변경되었으나 세션 재발급에 실패했습니다. 다시 로그인해주세요." },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
