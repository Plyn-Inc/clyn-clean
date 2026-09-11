export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDatabaseReady } = await import("@/database");
    await ensureDatabaseReady();

    // 특수일 캐시 상태만 확인하고 경고를 남긴다.
    // 부팅 시 KASI를 수백 회 호출해 서버 초기화를 막지 않는다.
    // 실제 동기화는 Vercel Cron(/api/cron/special-days) 또는 관리자 화면에서 수행한다.
    try {
      const { checkCoverage } = await import("@/lib/special-days-store");
      const coverage = await checkCoverage();
      if (!coverage.covered) {
        console.warn(
          `[special-days] 캐시 미비: ${coverage.issues.join(" / ")} ` +
            `(${coverage.from}~${coverage.to}, ${coverage.actual}/${coverage.expected}건) ` +
            "— /api/cron/special-days 또는 관리자 화면에서 동기화가 필요합니다."
        );
      }
    } catch (e) {
      console.error("[special-days] 캐시 상태 확인 실패", e);
    }
  }
}
