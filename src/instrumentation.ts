/**
 * Next.js instrumentation hook.
 *
 * Production 부팅 경로에서 DB I/O를 기다리지 않는다.
 *
 * 이유: 이 훅은 첫 요청 처리 전에 await되므로, 여기서 DB 조회가 지연되면
 *       홈페이지 static shell조차 내려가지 못하고 TTFB가 수십 초~수분이 된다.
 *       DB가 느리거나 unavailable이어도 서버는 즉시 요청을 받아야 한다.
 *
 * 이동한 작업:
 *   - admin seed        → 관리자 로그인 경로에서 lazy 수행 (ensureAdminSeeded)
 *   - special_days 커버리지 확인 → /api/cron/special-days, 관리자 화면
 *   - migration         → 배포 단계(supabase migration)
 *
 * 여기서는 환경변수 유효성만 동기적으로 확인한다 (DB 접근 없음).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // DB 접근 없이 설정 오류만 조기에 드러낸다.
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
    console.error("[startup] DATABASE_URL이 설정되지 않았습니다. PostgreSQL 연결이 불가합니다.");
  }
  if (process.env.NODE_ENV === "production" && !process.env.KASI_SERVICE_KEY) {
    console.warn("[startup] KASI_SERVICE_KEY 미설정 — 특수일 동기화가 실패합니다.");
  }
}
