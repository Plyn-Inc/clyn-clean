import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { cancelOverdueReservation, getReservationById, getPaymentByReservationId } from "@/lib/reservations";

/**
 * 입금기한 초과 예약 수동 취소 API (관리자 전용)
 *
 * 허용 조건 — 아래 4가지를 모두 만족해야만 취소 처리됩니다.
 *   1. 예약 상태가 received 또는 awaiting_deposit
 *   2. 입금 상태가 pending
 *   3. 입금 기한(payment_due_date) 값이 존재함
 *   4. 입금 기한이 현재 시각보다 과거(= 기한 초과)
 *
 * 다음 경우에는 취소 불가:
 *   - 입금 확인 완료된 예약 (payment_status = confirmed)
 *   - 예약 확정 상태 (reservation_status = confirmed)
 *   - 이미 취소된 예약 (reservation_status = cancelled)
 *   - 작업 완료 상태 (reservation_status = completed)
 *   - 입금 기한이 아직 남아 있는 경우
 */
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

  const payment = await getPaymentByReservationId(reservationId);

  // 조건 1: 예약 상태 확인 (received 또는 awaiting_deposit만 허용)
  const allowedStatuses = ["received", "awaiting_deposit"];
  if (!allowedStatuses.includes(reservation.reservation_status)) {
    return NextResponse.json(
      {
        error: "입금기한 초과 상태의 입금 대기 예약만 수동 취소할 수 있습니다.",
        detail: `현재 예약 상태: ${reservation.reservation_status}`,
      },
      { status: 409 }
    );
  }

  // 조건 2: 입금 상태 확인 (pending만 허용 — confirmed이면 이미 입금됐으므로 취소 불가)
  if (!payment || payment.payment_status !== "pending") {
    return NextResponse.json(
      {
        error: "입금기한 초과 상태의 입금 대기 예약만 수동 취소할 수 있습니다.",
        detail: `현재 입금 상태: ${payment?.payment_status ?? "없음"}`,
      },
      { status: 409 }
    );
  }

  // 조건 3: 입금 기한 값 존재 여부
  if (!payment.payment_due_date) {
    return NextResponse.json(
      {
        error: "입금 기한 정보가 없어 기한 초과 여부를 확인할 수 없습니다.",
      },
      { status: 400 }
    );
  }

  // 조건 4: 입금 기한이 실제로 지났는지 확인
  const dueDate = new Date(payment.payment_due_date);
  const now = new Date();
  if (dueDate > now) {
    return NextResponse.json(
      {
        error: "입금 기한이 아직 지나지 않았습니다. 기한 초과 후에 수동 취소할 수 있습니다.",
        detail: `입금 기한: ${dueDate.toLocaleString("ko-KR")}`,
      },
      { status: 400 }
    );
  }

  // 4가지 조건 모두 통과 → 수동 취소 처리
  try {
    await cancelOverdueReservation(reservationId, session.name, session.adminId);
    return NextResponse.json({
      ok: true,
      message: "예약이 취소되었습니다. 해당 날짜 잔여석이 회복되었습니다.",
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "취소 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
