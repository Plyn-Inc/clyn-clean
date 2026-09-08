import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  changeReservationSlot,
  SlotConflictError,
  DateNotAvailableError,
} from "@/lib/reservations";
import { isValidDateFormat, isPastDateKST, isTooFarFuture } from "@/lib/utils";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const { id } = await ctx.params;
  const reservationId = Number(id);
  if (!reservationId || !Number.isFinite(reservationId)) {
    return NextResponse.json({ error: "잘못된 예약 ID입니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.date || !body?.timeSlot) {
    return NextResponse.json(
      { error: "date와 timeSlot(morning|afternoon)이 필요합니다." },
      { status: 400 }
    );
  }

  // 날짜 형식 검증
  if (!isValidDateFormat(body.date)) {
    return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });
  }

  // 과거 날짜 차단
  if (isPastDateKST(body.date)) {
    return NextResponse.json({ error: "과거 날짜로는 변경할 수 없습니다." }, { status: 400 });
  }

  // 1년 이후 날짜 차단
  if (isTooFarFuture(body.date, 365)) {
    return NextResponse.json({ error: "1년 이후 날짜로는 변경할 수 없습니다." }, { status: 400 });
  }

  // timeSlot 검증 (morning/afternoon만 허용)
  if (body.timeSlot !== "morning" && body.timeSlot !== "afternoon") {
    return NextResponse.json(
      { error: "timeSlot은 morning(오전) 또는 afternoon(오후)이어야 합니다." },
      { status: 400 }
    );
  }

  try {
    await changeReservationSlot(
      reservationId,
      body.date,
      body.timeSlot,
      session.name,
      session.adminId
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SlotConflictError) {
      return NextResponse.json({ error: e.message, code: "SLOT_CONFLICT" }, { status: 409 });
    }
    if (e instanceof DateNotAvailableError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
    }
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
