import { NextRequest, NextResponse } from "next/server";
import {
  findRange,
  aggregatePublicReservationStatesInRange,
  type CalendarDayRow,
} from "@/database/repositories/calendar-repository";
import { toPublicSlotStatus } from "@/lib/types";
import {
  getSpecialDayMeta as getStaticSpecialDayMeta,
  isYearSupported as isStaticSpecialDaySupported,
} from "@/lib/special-days";
import { bookingMinDate, bookingMaxDate } from "@/lib/booking-window";

function eachDate(start: string, end: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

/**
 * 공개 캘린더 경량 API.
 *
 * DB round-trip은 월 범위 기준 2회뿐이다.
 * 1) calendar_days 범위
 * 2) reservations 진행/완료 단일 집계
 *
 * 특수일 표시는 정적 데이터에서 계산하고, 고객에게는
 * 예약가능 / 예약진행 중 / 예약완료 세 상태만 내려준다.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start, end 쿼리 파라미터가 필요합니다." }, { status: 400 });
  }

  const minD = bookingMinDate();
  const maxD = bookingMaxDate();
  const clampedStart = start < minD ? minD : start > maxD ? maxD : start;
  const clampedEnd = end > maxD ? maxD : end < minD ? minD : end;
  if (clampedStart > clampedEnd) {
    return NextResponse.json({ days: [], bookingMinDate: minD, bookingMaxDate: maxD });
  }

  const [calendarRows, reservationStates] = await Promise.all([
    findRange(clampedStart, clampedEnd),
    aggregatePublicReservationStatesInRange(clampedStart, clampedEnd),
  ]);

  const byDate = new Map<string, CalendarDayRow[]>();
  for (const row of calendarRows) {
    const rows = byDate.get(row.date) ?? [];
    rows.push(row);
    byDate.set(row.date, rows);
  }

  function stateOn(date: string, slot: "morning" | "afternoon") {
    const direct = reservationStates.get(`${date}|${slot}`) ?? { activeCount: 0, confirmedCount: 0 };
    const allDay = reservationStates.get(`${date}|all_day`) ?? { activeCount: 0, confirmedCount: 0 };
    return {
      activeCount: direct.activeCount + allDay.activeCount,
      confirmedCount: direct.confirmedCount + allDay.confirmedCount,
      allDayBlocked: allDay.activeCount > 0,
    };
  }

  const publicDays = eachDate(clampedStart, clampedEnd).map((date) => {
    const rows = byDate.get(date) ?? [];
    const allDayRow = rows.find((row) => row.time_slot === "all_day");
    const morningRow = rows.find((row) => row.time_slot === "morning");
    const afternoonRow = rows.find((row) => row.time_slot === "afternoon");
    const morningState = stateOn(date, "morning");
    const afternoonState = stateOn(date, "afternoon");

    function buildSlot(slotRow: CalendarDayRow | undefined, state: ReturnType<typeof stateOn>) {
      const adminStatus = allDayRow?.status ?? slotRow?.status ?? "available";
      const capacity = slotRow?.capacity ?? allDayRow?.capacity ?? 1;
      const remaining = Math.max(capacity - state.activeCount, 0);
      const publicStatus = toPublicSlotStatus({
        effectiveStatus: adminStatus,
        remaining,
        hasConfirmed: state.confirmedCount > 0,
      });
      return {
        publicStatus,
        selectable: adminStatus === "available" && remaining > 0,
        consultRequired: adminStatus === "consult_required",
      };
    }

    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    const special = isStaticSpecialDaySupported(date) ? getStaticSpecialDayMeta(date) : null;

    return {
      date,
      isWeekend: wd === 0 || wd === 6,
      isSaturday: wd === 6,
      isSunday: wd === 0,
      isHoliday: special?.isHoliday ?? false,
      isSonEomneunDay: special?.isSonEomneunDay ?? false,
      badge: special?.customerBadge ?? null,
      specialDaySynced: isStaticSpecialDaySupported(date),
      allDayBlocked: morningState.allDayBlocked || afternoonState.allDayBlocked,
      morning: buildSlot(morningRow, morningState),
      afternoon: buildSlot(afternoonRow, afternoonState),
    };
  });

  return NextResponse.json(
    {
      days: publicDays,
      bookingMinDate: minD,
      bookingMaxDate: maxD,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
      },
    }
  );
}
