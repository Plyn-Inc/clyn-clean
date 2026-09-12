import { NextRequest, NextResponse } from "next/server";
import { verifyAdminPassword, createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력해주세요." }, { status: 400 });
  }

  // 관리자 계정 seed는 서버 부팅이 아니라 이 경로에서 lazy 수행한다.
  // (부팅 경로에서 DB를 기다리면 홈페이지 TTFB가 DB 응답에 묶인다)
  try {
    const { ensureAdminSeeded } = await import("@/database");
    await ensureAdminSeeded();
  } catch (e) {
    console.error("[admin] 계정 초기화 실패", e);
    return NextResponse.json(
      { error: "관리자 계정을 준비하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 503 }
    );
  }

  const admin = await verifyAdminPassword(body.username, body.password);
  if (!admin) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  let token: string;
  try {
    token = await createSessionToken({
      adminId: admin.id,
      username: admin.username,
      name: admin.name,
      mustChangePassword: admin.must_change_password === 1,
    });
  } catch (e) {
    // 운영 환경에서 JWT_SECRET 미설정 시 getJwtSecret()이 throw합니다.
    // 관리자 로그인을 차단하고 서버 로그에 상세 내용을 남깁니다.
    console.error("[moving-clean] 관리자 로그인 차단:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: "서버 설정 오류로 로그인할 수 없습니다. 관리자에게 문의하세요. (JWT_SECRET 미설정)" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({
    ok: true,
    name: admin.name,
    mustChangePassword: admin.must_change_password === 1,
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
