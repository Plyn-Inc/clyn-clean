import { NextRequest, NextResponse } from "next/server";
import { dispatchPending, reconcileDeliveries } from "@/lib/notifications/dispatcher";
import { defaultProvider } from "@/lib/notifications/solapi-provider";

/**
 * 알림 발송 processor.
 *
 * Vercel Cron 전용. 외부 provider 호출은 이 경로에서만 일어나며
 * business transaction과 완전히 분리되어 있다.
 *
 * 중복 호출돼도 outbox claim(SKIP LOCKED / 직렬화)이 같은 row를 두 번 보내지 않는다.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 503 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const provider = defaultProvider();
    // 1) 대기 중인 알림 발송
    const summary = await dispatchPending(provider, 20);
    // 2) 접수된 알림톡의 실제 전달 결과 확인 → 실패 시 문자 대체
    const reconcile = await reconcileDeliveries(provider, 20);
    return NextResponse.json({ ok: true, summary, reconcile });
  } catch (e) {
    console.error(`[cron/notifications] code=${(e as { code?: string })?.code ?? "UNKNOWN"}`);
    return NextResponse.json({ error: "발송 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
