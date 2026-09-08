import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { confirmPayment, getReservationById } from "@/lib/reservations";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const { id } = await ctx.params;
  const reservationId = Number(id);
  const reservation = await getReservationById(reservationId);
  if (!reservation) {
    return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  try {
    await confirmPayment(reservationId, session.name, session.adminId, body?.memo);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "입금 확인 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
