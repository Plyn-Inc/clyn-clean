import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { getReservationById, updatePaymentStatus, updateReservationStatus } from "@/lib/reservations";
import type { PaymentStatus } from "@/lib/types";

// "confirmed" 진입은 반드시 confirm-payment API를 통해야 합니다.
// 이 API는 confirmed를 허용하지 않습니다.
// 이유: confirmed 처리 시 reservation_status도 awaiting_admin_check으로 함께 전환해야 하므로
//      단순 payment-status 변경으로는 상태 불일치가 발생합니다.
const ALLOWED_VIA_STATUS_API: PaymentStatus[] = [
  "pending",
  "unconfirmed",
  "refund_required",
  "refunded",
];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const reservationId = Number(id);

  if (!body?.status) {
    return NextResponse.json({ error: "status 값이 필요합니다." }, { status: 400 });
  }

  if (body.status === "confirmed") {
    return NextResponse.json(
      {
        error:
          "선입금 확인은 /confirm-payment API를 사용해주세요. " +
          "이 API로 confirmed를 직접 설정하면 예약 상태와 불일치가 발생합니다.",
        code: "USE_CONFIRM_PAYMENT_API",
      },
      { status: 400 }
    );
  }

  if (!ALLOWED_VIA_STATUS_API.includes(body.status as PaymentStatus)) {
    return NextResponse.json({ error: "올바르지 않은 입금 상태값입니다." }, { status: 400 });
  }

  try {
    await updatePaymentStatus(reservationId, body.status as PaymentStatus, session.name, session.adminId);
    // 환불 상태 변경 시 예약 상태도 동기화. 이미 취소된 예약은 cancelled -> cancelled 재전이를 시도하지 않음.
    if (body.status === "refund_required" || body.status === "refunded") {
      const reservation = await getReservationById(reservationId);
      if (reservation && reservation.reservation_status !== "cancelled") {
        await updateReservationStatus(reservationId, "cancelled", session.name, session.adminId, `입금 상태 변경: ${body.status}`);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
