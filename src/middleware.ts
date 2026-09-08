import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Edge 런타임에서는 Node.js 모듈을 import할 수 없으므로 직접 정의합니다.
// jwt-config.ts의 DEV_FALLBACK_SECRET과 반드시 동일한 값을 유지해야 합니다.
// 변경 시 두 파일을 동시에 변경하세요.
const DEV_FALLBACK_SECRET = "dev-only-jwt-secret-do-not-use-in-production-32ch";
const SESSION_COOKIE_NAME = "moving_clean_admin_session";

/**
 * secretKey를 lazy하게 반환합니다.
 *
 * - production: JWT_SECRET 없으면 에러 throw → 관리자 경로 전체 401
 * - development/test: JWT_SECRET 없으면 fallback 사용
 *
 * JWT_SECRET 값 자체는 로그에 출력하지 않습니다.
 */
function getEdgeSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      // 민감정보(secret 값)는 절대 로그에 출력하지 않음
      throw new Error("[moving-clean] 운영 환경에서 JWT_SECRET이 설정되지 않았습니다.");
    }
    // 개발 환경에서만 fallback 허용
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }

  return new TextEncoder().encode(secret);
}

async function isValidSession(token: string): Promise<boolean> {
  try {
    const key = getEdgeSecretKey();
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 로그인 페이지/로그인 API는 인증 체크 없이 통과
  if (pathname === "/admin/login" || pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");

  if (isAdminPage || isAdminApi) {
    let valid = false;
    try {
      const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
      valid = token ? await isValidSession(token) : false;
    } catch {
      // production에서 JWT_SECRET 누락 시 getEdgeSecretKey()가 throw
      // → valid = false → 401/redirect로 처리
      valid = false;
    }

    if (!valid) {
      if (isAdminApi) {
        return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
