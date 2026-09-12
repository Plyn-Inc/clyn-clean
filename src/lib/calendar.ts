import * as calendarRepo from "@/database/repositories/calendar-repository";
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

async function toSlotView(
  date: string,
  timeSlot: "morning" | "afternoon",
  slotRow: calendarRepo.CalendarDayRow | undefined,
  allDayRow: calendarRepo.CalendarDayRow | undefined
): Promise<CalendarDayView> {
  const capacity = slotRow?.capacity ?? await defaultCapacity();
  const adminStatus: CalendarStatus = allDayRow?.status ?? slotRow?.status ?? "available";
  const bookedCount = await calendarRepo.countActiveReservationsOnSlot(date, timeSlot);
  const remaining = Math.max(capacity - bookedCount, 0);
  let effectiveStatus: CalendarStatus = adminStatus;
  if (adminStatus === "available" && remaining <= 0) effectiveStatus = "closed";
  return {
    date,
    timeSlot,
    status: adminStatus,
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
 * 이후 메모리에서 날짜별 결과를 조립한다.
 */
export async function getSlotCalendarRange(startDate: string, endDate: string): Promise<DaySlotView[]> {
  const [rows, activeCounts, defaultCap] = await Promise.all([
    calendarRepo.findRange(startDate, endDate),
    calendarRepo.aggregateActiveReservationsInRange(startDate, endDate),
    defaultCapacity(),
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
    const capacity = slotRow?.capacity ?? defaultCap;
    const adminStatus: CalendarStatus = allDayRow?.status ?? slotRow?.status ?? "available";
    const bookedCount = bookedOn(date, timeSlot);
    const remaining = Math.max(capacity - bookedCount, 0);
    let effectiveStatus: CalendarStatus = adminStatus;
    if (adminStatus === "available" && remaining <= 0) effectiveStatus = "closed";
    return {
      date,
      timeSlot,
      status: adminStatus,
      capacity,
      bookedCount,
      remaining,
      memo: slotRow?.memo ?? allDayRow?.memo ?? null,
      effectiveStatus,
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
  await calendarRepo.upsert(date, timeSlot, status, capacity ?? await defaultCapacity(), memo);
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
