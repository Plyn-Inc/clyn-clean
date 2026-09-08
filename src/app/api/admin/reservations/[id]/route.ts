import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { getReservationById, getPaymentByReservationId, getLogsByReservationId } from "@/lib/reservations";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const reservationId = Number(id);
  const reservation = await getReservationById(reservationId);
  if (!reservation) {
    return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
  }
  const payment = await getPaymentByReservationId(reservationId);
  const logs = await getLogsByReservationId(reservationId);

  return NextResponse.json({ reservation, payment, logs });
}
