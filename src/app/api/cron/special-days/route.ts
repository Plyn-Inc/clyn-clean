import { NextRequest, NextResponse } from "next/server";
import { syncSpecialDaysIncremental, checkCoverage } from "@/lib/special-days-store";
import { KasiUnavailableError } from "@/lib/kasi";

/**
 * Vercel Cron 전용 특수일 동기화 엔드포인트.
 *
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 관리자 세션 인증과 혼용하지 않는다 (별도 인증 경로).
 *
 * 증분 동기화를 사용해 매번 전체 425일을 다시 조회하지 않는다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET이 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncSpecialDaysIncremental();
    const coverage = await checkCoverage();
    return NextResponse.json({ ok: true, result, coverage });
  } catch (e) {
    if (e instanceof KasiUnavailableError) {
      // 기존 캐시는 훼손되지 않았다
      return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    }
    console.error("[cron/special-days]", e);
    return NextResponse.json({ error: "동기화 중 오류가 발생했습니다." }, { status: 500 });
  }
}
