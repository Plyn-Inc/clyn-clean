/**
 * JWT_SECRET 설정 공통 모듈
 *
 * auth.ts (토큰 생성/검증)와 middleware.ts (Edge에서 토큰 검증) 양쪽에서
 * 동일한 시크릿을 사용해야 로그인 토큰이 유효합니다.
 *
 * 빌드 시에는 이 함수가 호출되지 않습니다.
 * 실제 관리자 로그인/세션 생성 시점에 호출되며, 운영 환경에서 JWT_SECRET이 없으면
 * 에러를 throw해서 관리자 로그인 자체를 차단합니다.
 */

const DEV_FALLBACK_SECRET = "dev-only-jwt-secret-do-not-use-in-production-32ch";

/**
 * JWT 시크릿을 반환합니다.
 *
 * - 개발 환경(NODE_ENV !== 'production'): JWT_SECRET이 없으면 fallback 사용
 * - 운영 환경(NODE_ENV === 'production'): JWT_SECRET이 없으면 에러를 throw하여
 *   관리자 로그인/세션 생성을 완전히 차단합니다.
 *   빌드 실패는 발생하지 않으며, 런타임 요청 처리 시점에 차단됩니다.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[moving-clean] ⛔ 운영 환경에서 JWT_SECRET이 설정되어 있지 않습니다.\n" +
        "  관리자 로그인이 차단됩니다.\n" +
        "  .env에 32자 이상의 무작위 문자열을 설정하세요:\n" +
        "  JWT_SECRET=$(openssl rand -hex 32)"
      );
    }
    // 개발/테스트 환경: fallback 사용 (운영 배포 시 반드시 교체 필요)
    return DEV_FALLBACK_SECRET;
  }

  return secret;
}
