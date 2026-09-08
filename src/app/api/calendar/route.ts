import { NextRequest, NextResponse } from "next/server";
import { getSlotCalendarRange } from "@/lib/calendar";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start, end 쿼리 파라미터가 필요합니다." }, { status: 400 });
  }

  // 날짜별 오전/오후 슬롯 구조로 반환
  const days = await getSlotCalendarRange(start, end);
  return NextResponse.json({ days });
}
