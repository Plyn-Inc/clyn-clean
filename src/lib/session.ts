import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken, type AdminSession } from "./auth";

export async function getServerSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireSession(): Promise<AdminSession> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

/**
 * 모든 /api/admin/* route handler의 첫 줄에서 호출해야 하는 인증 가드.
 *
 * 세션이 없으면 { response } 를 반환하므로 호출부에서 즉시 return해야 한다:
 *
 *   const guard = await requireAdminApiSession();
 *   if ("response" in guard) return guard.response;
 *   const { session } = guard;
 *
 * 미들웨어는 /admin 페이지 접근만 보호하고 /api/admin/* 는 보호 범위 밖이므로,
 * 모든 관리자 API는 반드시 이 가드를 거쳐야 한다 (명세 4번: API 서버단 인증 필수).
 */
export async function requireAdminApiSession(): Promise<
  { response: NextResponse } | { session: AdminSession }
> {
  const session = await getServerSession();
  if (!session) {
    return { response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }
  return { session };
}
