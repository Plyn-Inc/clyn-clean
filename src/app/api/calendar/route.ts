import { NextRequest, NextResponse } from "next/server";
import { getSlotCalendarRange } from "@/lib/calendar";
import { releaseExpiredDepositReservations } from "@/lib/reservations";
import { hasConfirmedReservationOnSlot } from "@/database/repositories/calendar-repository";
import { toPublicSlotStatus } from "@/lib/types";
import { getSpecialDayRange } from "@/lib/special-days-store";
import { bookingMinDate, bookingMaxDate } from "@/lib/booking-window";

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

  // 요청 범위를 예약 가능 기간으로 제한한다 (범위 밖 조회 차단)
  const minD = bookingMinDate();
  const maxD = bookingMaxDate();
  const clampedStart = start < minD ? minD : start > maxD ? maxD : start;
  const clampedEnd = end > maxD ? maxD : end < minD ? minD : end;
  if (clampedStart > clampedEnd) {
    return NextResponse.json({ days: [], bookingMinDate: minD, bookingMaxDate: maxD });
  }

  // 입금기한이 지난 예약을 먼저 만료 처리한다 (별도 스케줄러 없이 lazy 실행).
  // 실패해도 캘린더 조회 자체는 계속되어야 하므로 예외를 삼킨다.
  try {
    await releaseExpiredDepositReservations();
  } catch (e) {
    console.error("[calendar] 입금기한 만료 처리 실패", e);
  }

  const days = await getSlotCalendarRange(clampedStart, clampedEnd);
  // 특수일은 DB 캐시에서 한 번에 읽는다 (KASI 실시간 호출 없음)
  const specialMap = await getSpecialDayRange(clampedStart, clampedEnd);

  // 내부 수치(capacity/remaining/bookedCount)를 제거하고 공개상태만 노출한다.
  const publicDays = await Promise.all(
    days.map(async (day) => {
      const [morningConfirmed, afternoonConfirmed] = await Promise.all([
        hasConfirmedReservationOnSlot(day.date, "morning"),
        hasConfirmedReservationOnSlot(day.date, "afternoon"),
      ]);
      // 특수일 메타 — 시각적 구분용. 가격 가산 사유는 포함하지 않는다.
      // 토/일은 서버가 날짜로 직접 계산하므로 캐시가 없어도 정확하다.
      const wd = new Date(`${day.date}T00:00:00Z`).getUTCDay();
      const special = specialMap.get(day.date);
      return {
        date: day.date,
        isWeekend: wd === 0 || wd === 6,
        isSaturday: wd === 6,
        isSunday: wd === 0,
        isHoliday: special?.isHoliday ?? false,
        isSonEomneunDay: special?.isSonEomneunDay ?? false,
        badge: special?.customerBadge ?? null,
        // 캐시가 없는 날짜는 예약 선택을 허용하지 않는다 (일반일로 간주 금지)
        specialDaySynced: !!special,
        morning: {
          publicStatus: toPublicSlotStatus({
            effectiveStatus: day.morning.effectiveStatus,
            remaining: day.morning.remaining,
            hasConfirmed: morningConfirmed,
          }),
          selectable: !!special && day.morning.effectiveStatus === "available" && day.morning.remaining > 0,
          consultRequired: day.morning.effectiveStatus === "consult_required",
        },
        afternoon: {
          publicStatus: toPublicSlotStatus({
            effectiveStatus: day.afternoon.effectiveStatus,
            remaining: day.afternoon.remaining,
            hasConfirmed: afternoonConfirmed,
          }),
          selectable: !!special && day.afternoon.effectiveStatus === "available" && day.afternoon.remaining > 0,
          consultRequired: day.afternoon.effectiveStatus === "consult_required",
        },
      };
    })
  );

  return NextResponse.json({
    days: publicDays,
    bookingMinDate: bookingMinDate(),
    bookingMaxDate: bookingMaxDate(),
  });
}
