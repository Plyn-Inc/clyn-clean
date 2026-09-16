import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { listDiscountAdjustments } from "@/database/repositories/reservation-repository";
import { listByReservation } from "@/database/repositories/outbox-repository";

/** 예약 상세 부가정보 — 할인 audit + 메시지 발송이력 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const reservationId = Number(id);
  if (!Number.isFinite(reservationId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const [adjustments, notifications] = await Promise.all([
    listDiscountAdjustments(reservationId),
    listByReservation(reservationId),
  ]);
  return NextResponse.json({ adjustments, notifications });
}
