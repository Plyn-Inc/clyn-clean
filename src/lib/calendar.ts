import * as calendarRepo from "@/database/repositories/calendar-repository";
import { withTransaction } from "@/database/connection";
import { getSetting } from "./settings";
import { toKSTDateString } from "./utils";
import type { CalendarStatus, TimeSlot } from "./types";

export interface CalendarDayView {
  date: string;
  timeSlot: TimeSlot;
  status: CalendarStatus;
  capacity: number;
  bookedCount: number;
  remaining: number;
  memo: string | null;
  effectiveStatus: CalendarStatus;
  /** 사이청소(all_day) 예약이 이 날짜를 점유해 보호 중인지 */
  blockedByAllDay?: boolean;
  /** 관리자가 수동 재개방했는지 (실제 예약 점유가 우선) */
  reopened?: boolean;
}

export interface DaySlotView {
  date: string;
  allDay: CalendarDayView | null;
  morning: CalendarDayView;
  afternoon: CalendarDayView;
}

async function defaultCapacity(): Promise<number> {
  const v = Number((await getSetting("default_daily_capacity")) || 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * 재개방 override는 사이청소 보호를 선택적으로 완화하는 보조 기능이다.
 * 이 조회가 실패했을 때 캘린더 전체를 500으로 만들지 않고, override가 없는
 * 것으로 처리한다. 그러면 all_day 보호는 그대로 유지되어 과예약 방향으로
 * 실패하지 않는다(fail-closed).
 */
async function safeFindReopenOverride(
  date: string,
  timeSlot: "morning" | "afternoon"
): Promise<calendarRepo.SlotReopenOverrideRow | undefined> {
  try {
    return await calendarRepo.findReopenOverride(date, timeSlot);
  } catch (error) {
    console.error(
      "[calendar] slot reopen override 조회 실패; 재개방 없이 계속합니다.",
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

async function safeFindReopenOverridesInRange(
  startDate: string,
  endDate: string
): Promise<Map<string, calendarRepo.SlotReopenOverrideRow>> {
  try {
    return await calendarRepo.findReopenOverridesInRange(startDate, endDate);
  } catch (error) {
    console.error(
      "[calendar] slot reopen override 범위 조회 실패; 재개방 없이 계속합니다.",
      error instanceof Error ? error.message : error
    );
    return new Map();
  }
}

async function toSlotView(
  date: string,
  timeSlot: "morning" | "afternoon",
  slotRow: calendarRepo.CalendarDayRow | undefined,
  allDayRow: calendarRepo.CalendarDayRow | undefined
): Promise<CalendarDayView> {
  const capacity = slotRow?.capacity ?? allDayRow?.capacity ?? await defaultCapacity();
  const adminStatus: CalendarStatus =
    allDayRow && allDayRow.status !== "available"
      ? allDayRow.status
      : slotRow?.status ?? allDayRow?.status ?? "available";

  // all_day 예약은 날짜 보호용이다. 관리자가 슬롯을 재개방한 경우에는
  // 그 all_day 예약 자체가 오전/오후 capacity를 소진한 것으로 계산하지 않는다.
  const [bookedCount, directBookedCount, blockedSet, override] = await Promise.all([
    calendarRepo.countActiveReservationsOnSlot(date, timeSlot),
    calendarRepo.countDirectActiveReservationsOnSlot(date, timeSlot),
    calendarRepo.findAllDayBlockedDates(date, date),
    safeFindReopenOverride(date, timeSlot),
  ]);
  const blockedByAllDay = blockedSet.has(date);
  const reopened = override?.is_open === 1;
  const capacityBookedCount = blockedByAllDay && reopened ? directBookedCount : bookedCount;
  const remaining = Math.max(capacity - capacityBookedCount, 0);
  let effectiveStatus: CalendarStatus = adminStatus;
  if (adminStatus === "available" && remaining <= 0) effectiveStatus = "closed";
  if (blockedByAllDay && !reopened) effectiveStatus = "closed";

  return {
    date,
    timeSlot,
    status: adminStatus,
    blockedByAllDay,
    reopened,
    capacity,
    bookedCount,
    remaining,
    memo: slotRow?.memo ?? allDayRow?.memo ?? null,
    effectiveStatus,
  };
}

async function toAllDayView(
  date: string,
  row: calendarRepo.CalendarDayRow | undefined
): Promise<CalendarDayView> {
  const capacity = row?.capacity ?? await defaultCapacity();
  const status: CalendarStatus = row?.status ?? "available";
  const bookedCount = await calendarRepo.countActiveReservationsOnSlot(date, "all_day");
  const remaining = Math.max(capacity - bookedCount, 0);
  let effectiveStatus: CalendarStatus = status;
  if (status === "available" && remaining <= 0) effectiveStatus = "closed";
  return { date, timeSlot: "all_day", status, capacity, bookedCount, remaining, memo: row?.memo ?? null, effectiveStatus };
}

export async function getDaySlotView(date: string): Promise<DaySlotView> {
  const rows = await calendarRepo.findAllSlotsForDate(date);
  const allDayRow = rows.find((r) => r.time_slot === "all_day");
  const morningRow = rows.find((r) => r.time_slot === "morning");
  const afternoonRow = rows.find((r) => r.time_slot === "afternoon");
  const [allDay, morning, afternoon] = await Promise.all([
    allDayRow ? toAllDayView(date, allDayRow) : Promise.resolve(null),
    toSlotView(date, "morning", morningRow, allDayRow),
    toSlotView(date, "afternoon", afternoonRow, allDayRow),
  ]);
  return { date, allDay, morning, afternoon };
}

/**
 * 월 단위 캘린더 조회.
 *
 * N+1 제거: 날짜마다 count 쿼리를 반복하지 않고 범위 aggregate를 사용한다.
 * 쿼리 수는 날짜 개수와 무관하게 고정이다.
 *   1) calendar_days 범위 조회 1회
 *   2) 활성 예약 슬롯별 집계 1회
 *   3) 기본 capacity(settings) 1회
 *   4) 재개방 override 범위 조회 1회
 * 사이청소(all_day) 점유 여부는 활성 예약 집계 결과에서 파생해 별도 쿼리를 없앤다.
 */
export async function getSlotCalendarRange(startDate: string, endDate: string): Promise<DaySlotView[]> {
  const [rows, activeCounts, defaultCap, reopenOverrides] = await Promise.all([
    calendarRepo.findRange(startDate, endDate),
    calendarRepo.aggregateActiveReservationsInRange(startDate, endDate),
    defaultCapacity(),
    safeFindReopenOverridesInRange(startDate, endDate),
  ]);

  const byDate = new Map<string, calendarRepo.CalendarDayRow[]>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  /** 해당 슬롯의 활성 예약 수 (all_day 예약은 오전·오후 양쪽에 포함된다) */
  function bookedOn(date: string, timeSlot: "morning" | "afternoon" | "all_day"): number {
    const allDay = activeCounts.get(`${date}|all_day`) ?? 0;
    if (timeSlot === "all_day") {
      return (
        allDay +
        (activeCounts.get(`${date}|morning`) ?? 0) +
        (activeCounts.get(`${date}|afternoon`) ?? 0)
      );
    }
    return (activeCounts.get(`${date}|${timeSlot}`) ?? 0) + allDay;
  }

  function buildSlot(
    date: string,
    timeSlot: "morning" | "afternoon",
    slotRow: calendarRepo.CalendarDayRow | undefined,
    allDayRow: calendarRepo.CalendarDayRow | undefined
  ): CalendarDayView {
    const capacity = slotRow?.capacity ?? allDayRow?.capacity ?? defaultCap;
    const adminStatus: CalendarStatus =
      allDayRow && allDayRow.status !== "available"
        ? allDayRow.status
        : slotRow?.status ?? allDayRow?.status ?? "available";
    const directBookedCount = activeCounts.get(`${date}|${timeSlot}`) ?? 0;
    const bookedCount = bookedOn(date, timeSlot);

    // ── 사이청소 all_day 보호 ────────────────────────────────────────────
    // all_day는 실제 작업시간과 별개의 날짜 보호 플래그다.
    // 관리자가 재개방한 슬롯은 all_day 예약을 capacity에서 제외하되,
    // 해당 오전/오후에 들어온 실제 예약은 그대로 capacity를 소진한다.
    const blockedByAllDay = (activeCounts.get(`${date}|all_day`) ?? 0) > 0;
    const override = reopenOverrides.get(`${date}|${timeSlot}`);
    const reopened = override?.is_open === 1;
    const capacityBookedCount = blockedByAllDay && reopened ? directBookedCount : bookedCount;
    const remaining = Math.max(capacity - capacityBookedCount, 0);
    let effectiveStatus: CalendarStatus = adminStatus;
    if (adminStatus === "available" && remaining <= 0) effectiveStatus = "closed";
    if (blockedByAllDay && !reopened) {
      effectiveStatus = "closed";
    }

    return {
      date,
      timeSlot,
      status: adminStatus,
      capacity,
      bookedCount,
      remaining,
      memo: slotRow?.memo ?? allDayRow?.memo ?? null,
      effectiveStatus,
      blockedByAllDay,
      reopened,
    };
  }

  function buildAllDay(date: string, row: calendarRepo.CalendarDayRow): CalendarDayView {
    const capacity = row.capacity ?? defaultCap;
    const status: CalendarStatus = row.status ?? "available";
    const bookedCount = bookedOn(date, "all_day");
    const remaining = Math.max(capacity - bookedCount, 0);
    let effectiveStatus: CalendarStatus = status;
    if (status === "available" && remaining <= 0) effectiveStatus = "closed";
    return { date, timeSlot: "all_day", status, capacity, bookedCount, remaining, memo: row.memo ?? null, effectiveStatus };
  }

  const result: DaySlotView[] = [];
  const start = new Date(startDate + "T00:00:00+09:00");
  const end = new Date(endDate + "T23:59:59+09:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toKSTDateString(d);
    const dateRows = byDate.get(iso) ?? [];
    const allDayRow = dateRows.find((r) => r.time_slot === "all_day");
    const morningRow = dateRows.find((r) => r.time_slot === "morning");
    const afternoonRow = dateRows.find((r) => r.time_slot === "afternoon");
    result.push({
      date: iso,
      allDay: allDayRow ? buildAllDay(iso, allDayRow) : null,
      morning: buildSlot(iso, "morning", morningRow, allDayRow),
      afternoon: buildSlot(iso, "afternoon", afternoonRow, allDayRow),
    });
  }
  return result;
}

export async function getSlotEffectiveStatus(date: string, timeSlot: "morning" | "afternoon"): Promise<CalendarStatus> {
  const view = await getDaySlotView(date);
  return timeSlot === "morning" ? view.morning.effectiveStatus : view.afternoon.effectiveStatus;
}

export async function hasRemainingSlotFor(date: string, timeSlot: "morning" | "afternoon"): Promise<boolean> {
  const view = await getDaySlotView(date);
  return timeSlot === "morning" ? view.morning.remaining > 0 : view.afternoon.remaining > 0;
}

export async function getCalendarDay(date: string): Promise<CalendarDayView> {
  const row = await calendarRepo.findOne(date, "all_day");
  return toAllDayView(date, row);
}

export async function getEffectiveStatus(date: string): Promise<CalendarStatus> {
  return (await getCalendarDay(date)).effectiveStatus;
}

export async function getCalendarRange(startDate: string, endDate: string): Promise<CalendarDayView[]> {
  const slots = await getSlotCalendarRange(startDate, endDate);
  return slots.map((s) => s.allDay ?? s.morning);
}

export async function setCalendarDay(
  date: string,
  status: CalendarStatus,
  capacity?: number,
  memo?: string,
  timeSlot: TimeSlot = "all_day"
): Promise<void> {
  const resolvedCapacity = capacity ?? await defaultCapacity();

  await withTransaction(async () => {
    // 과거 all_day 관리자 행이 있으면 오전/오후에 실체화한 뒤 제거한다.
    // 이렇게 해야 이후 "오전만/오후만" 수정이 all_day 행에 가려져 풀린 것처럼 보이지 않는다.
    const legacyAllDay = await calendarRepo.findOne(date, "all_day");
    if (legacyAllDay) {
      const slots = ["morning", "afternoon"] as const;
      for (const slot of slots) {
        const existing = await calendarRepo.findOne(date, slot);
        if (!existing) {
          await calendarRepo.upsert(
            date,
            slot,
            legacyAllDay.status,
            legacyAllDay.capacity,
            legacyAllDay.memo ?? undefined
          );
        }
      }
      await calendarRepo.remove(date, "all_day");
    }

    // 관리자 UI의 "날짜 전체"는 별도 override 행을 남기는 기능이 아니라
    // 오전/오후 두 슬롯에 같은 설정을 동시에 적용하는 기능으로 처리한다.
    if (timeSlot === "all_day") {
      await calendarRepo.upsert(date, "morning", status, resolvedCapacity, memo);
      await calendarRepo.upsert(date, "afternoon", status, resolvedCapacity, memo);
      return;
    }

    await calendarRepo.upsert(date, timeSlot, status, resolvedCapacity, memo);
  });
}

export async function setCalendarRange(
  startDate: string,
  endDate: string,
  status: CalendarStatus,
  capacity?: number,
  memo?: string,
  timeSlot: TimeSlot = "all_day"
): Promise<void> {
  await calendarRepo.upsertRange(startDate, endDate, timeSlot, status, capacity ?? await defaultCapacity(), memo);
}

export function deleteCalendarDay(date: string, timeSlot: TimeSlot = "all_day"): Promise<void> {
  return calendarRepo.remove(date, timeSlot);
}
