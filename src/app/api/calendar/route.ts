import { NextRequest, NextResponse } from "next/server";
import { getSlotCalendarRange } from "@/lib/calendar";
import { releaseExpiredDepositReservations } from "@/lib/reservations";
import { hasConfirmedReservationOnSlot } from "@/database/repositories/calendar-repository";
import { toPublicSlotStatus } from "@/lib/types";

/**
 * 공개 캘린더 API.
 *
 * 고객에게는 예약 수량을 노출하지 않는다 (요구사항 21·33).
 * capacity / remaining / bookedCount는 응답에 포함되지 않으며,
 * 예약가능 / 예약진행 중 / 예약완료 3종 상태만 반환한다.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start, end 쿼리 파라미터가 필요합니다." }, { status: 400 });
  }

  // 입금기한이 지난 예약을 먼저 만료 처리한다 (별도 스케줄러 없이 lazy 실행).
  // 실패해도 캘린더 조회 자체는 계속되어야 하므로 예외를 삼킨다.
  try {
    await releaseExpiredDepositReservations();
  } catch (e) {
    console.error("[calendar] 입금기한 만료 처리 실패", e);
  }

  const days = await getSlotCalendarRange(start, end);

  // 내부 수치(capacity/remaining/bookedCount)를 제거하고 공개상태만 노출한다.
  const publicDays = await Promise.all(
    days.map(async (day) => {
      const [morningConfirmed, afternoonConfirmed] = await Promise.all([
        hasConfirmedReservationOnSlot(day.date, "morning"),
        hasConfirmedReservationOnSlot(day.date, "afternoon"),
      ]);
      return {
        date: day.date,
        morning: {
          publicStatus: toPublicSlotStatus({
            effectiveStatus: day.morning.effectiveStatus,
            remaining: day.morning.remaining,
            hasConfirmed: morningConfirmed,
          }),
          selectable: day.morning.effectiveStatus === "available" && day.morning.remaining > 0,
          consultRequired: day.morning.effectiveStatus === "consult_required",
        },
        afternoon: {
          publicStatus: toPublicSlotStatus({
            effectiveStatus: day.afternoon.effectiveStatus,
            remaining: day.afternoon.remaining,
            hasConfirmed: afternoonConfirmed,
          }),
          selectable: day.afternoon.effectiveStatus === "available" && day.afternoon.remaining > 0,
          consultRequired: day.afternoon.effectiveStatus === "consult_required",
        },
      };
    })
  );

  return NextResponse.json({ days: publicDays });
}
