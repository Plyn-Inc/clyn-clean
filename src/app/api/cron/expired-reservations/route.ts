import { NextRequest, NextResponse } from "next/server";
import { releaseExpiredDepositReservations } from "@/lib/reservations";

export const dynamic = "force-dynamic";

/** 공개 캘린더 요청과 분리된 예약금 기한 만료 정리 작업. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 503 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const released = await releaseExpiredDepositReservations();
    return NextResponse.json({ ok: true, released });
  } catch (error) {
    console.error("[cron/expired-reservations]", error);
    return NextResponse.json({ error: "만료 예약 정리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
