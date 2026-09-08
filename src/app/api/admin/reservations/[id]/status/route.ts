import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { updateReservationStatus } from "@/lib/reservations";
import type { ReservationStatus } from "@/lib/types";

// "confirmed" 진입은 반드시 confirm-reservation API를 통해야 함.
// 이 API에서는 confirmed 직접 변경을 차단합니다.
const ALLOWED_VIA_STATUS_API: ReservationStatus[] = [
  "received",
  "awaiting_deposit",
  "awaiting_admin_check",
  "consult_required",
  "cancelled",
  "completed",
];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);

  if (!body?.status) {
    return NextResponse.json({ error: "status 값이 필요합니다." }, { status: 400 });
  }

  // confirmed는 이 API로 변경 불가 — confirm-reservation API 사용
  if (body.status === "confirmed") {
    return NextResponse.json(
      {
        error:
          "'예약 확정' 상태는 이 API로 변경할 수 없습니다. " +
          "선입금 확인 후 /confirm-reservation API를 사용해주세요.",
        code: "USE_CONFIRM_RESERVATION_API",
      },
      { status: 400 }
    );
  }

  if (!ALLOWED_VIA_STATUS_API.includes(body.status as ReservationStatus)) {
    return NextResponse.json({ error: "올바르지 않은 상태값입니다." }, { status: 400 });
  }

  try {
    await updateReservationStatus(Number(id), body.status as ReservationStatus, session.name, session.adminId, body.detail);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
