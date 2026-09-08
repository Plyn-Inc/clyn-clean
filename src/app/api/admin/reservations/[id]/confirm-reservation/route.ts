import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { confirmReservation } from "@/lib/reservations";

/**
 * 관리자 최종 예약확정 API
 *
 * 조건:
 *   1. 예약 존재
 *   2. payment_status === "confirmed"  (선입금 확인 완료)
 *   3. reservation_status === "awaiting_admin_check"
 *
 * 조건 미충족 시 400/409 반환.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const { id } = await ctx.params;
  const reservationId = Number(id);
  if (!reservationId) {
    return NextResponse.json({ error: "잘못된 예약 ID입니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));

  try {
    await confirmReservation(reservationId, session.name, session.adminId, body?.memo);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error) {
      const status = e.message.includes("선입금") || e.message.includes("상태") ? 409 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error(e);
    return NextResponse.json({ error: "예약 확정 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
