import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { getSlotCalendarRange, setCalendarDay } from "@/lib/calendar";
import type { CalendarStatus, TimeSlot } from "@/lib/types";

const VALID_STATUSES: CalendarStatus[] = ["available", "closed", "consult_required", "off"];
const VALID_SLOTS: TimeSlot[] = ["all_day", "morning", "afternoon"];

export async function GET(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start, end 쿼리 파라미터가 필요합니다." }, { status: 400 });
  }

  const days = await getSlotCalendarRange(start, end);
  return NextResponse.json({ days });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body?.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "올바르지 않은 상태값입니다." }, { status: 400 });
  }

  const timeSlot: TimeSlot = VALID_SLOTS.includes(body.timeSlot) ? body.timeSlot : "all_day";

  const capacity = body.capacity !== undefined ? Number(body.capacity) : undefined;
  if (capacity !== undefined && (!Number.isFinite(capacity) || capacity < 0)) {
    return NextResponse.json({ error: "예약 가능 건수는 0 이상의 숫자여야 합니다." }, { status: 400 });
  }

  if (!body.date) {
    return NextResponse.json({ error: "date가 필요합니다." }, { status: 400 });
  }

  await setCalendarDay(body.date, body.status, capacity, body.memo, timeSlot);
  return NextResponse.json({ ok: true });
}
