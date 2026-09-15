import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  findReopenOverridesInRange,
  upsertReopenOverride,
  deleteReopenOverride,
  findAllDayBlockedDates,
} from "@/database/repositories/calendar-repository";
import { isValidDateFormat } from "@/lib/utils";

/**
 * 사이청소(all_day) 보호 날짜의 슬롯 재개방 관리.
 *
 * 실제 예약 점유가 override보다 우선한다. 이 API는 "사이청소 종일 보호"만
 * 해제할 뿐, 이미 예약이 찬 슬롯을 강제로 열지 않는다.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end || !isValidDateFormat(start) || !isValidDateFormat(end)) {
    return NextResponse.json({ error: "start, end 날짜가 필요합니다." }, { status: 400 });
  }

  const [overrides, blocked] = await Promise.all([
    findReopenOverridesInRange(start, end),
    findAllDayBlockedDates(start, end),
  ]);

  return NextResponse.json({
    overrides: [...overrides.values()],
    allDayBlockedDates: [...blocked],
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const body = await req.json().catch(() => null);
  const date = String(body?.date ?? "");
  const timeSlot = body?.timeSlot;

  if (!isValidDateFormat(date)) {
    return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (timeSlot !== "morning" && timeSlot !== "afternoon") {
    return NextResponse.json({ error: "오전 또는 오후만 지정할 수 있습니다." }, { status: 400 });
  }

  if (body?.action === "clear") {
    await deleteReopenOverride(date, timeSlot);
    return NextResponse.json({ ok: true });
  }

  await upsertReopenOverride({
    date,
    timeSlot,
    isOpen: body?.isOpen === true,
    reason: body?.reason ? String(body.reason) : null,
    sourceReservationId: body?.sourceReservationId ?? null,
    adminId: session.adminId,
  });
  return NextResponse.json({ ok: true });
}
