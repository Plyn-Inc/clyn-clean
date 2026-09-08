import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { updateFinalConfirmedTotal } from "@/lib/reservations";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const reservationId = Number(id);

  if (!reservationId) {
    return NextResponse.json({ error: "잘못된 예약 ID입니다." }, { status: 400 });
  }

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "올바른 금액을 입력해주세요." }, { status: 400 });
  }

  try {
    await updateFinalConfirmedTotal(reservationId, Math.round(amount), session.name, session.adminId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
