import { execute, queryRow, queryRows } from "../connection";
import type { CalendarStatus, TimeSlot } from "@/lib/types";

export interface CalendarDayRow {
  date: string;
  time_slot: TimeSlot;
  status: CalendarStatus;
  capacity: number;
  memo: string | null;
  updated_at: string;
}

export function findRange(startDate: string, endDate: string): Promise<CalendarDayRow[]> {
  return queryRows<CalendarDayRow>(
    `SELECT * FROM calendar_days WHERE date >= ? AND date <= ? ORDER BY date ASC, time_slot ASC`,
    [startDate, endDate]
  );
}

export function findOne(date: string, timeSlot: TimeSlot = "all_day"): Promise<CalendarDayRow | undefined> {
  return queryRow<CalendarDayRow>(
    "SELECT * FROM calendar_days WHERE date = ? AND time_slot = ?",
    [date, timeSlot]
  );
}

export function findAllSlotsForDate(date: string): Promise<CalendarDayRow[]> {
  return queryRows<CalendarDayRow>(
    "SELECT * FROM calendar_days WHERE date = ? ORDER BY time_slot ASC",
    [date]
  );
}

export function upsert(
  date: string,
  timeSlot: TimeSlot,
  status: CalendarStatus,
  capacity: number,
  memo?: string
): Promise<void> {
  return execute(
    `INSERT INTO calendar_days (date, time_slot, status, capacity, memo, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(date, time_slot) DO UPDATE SET
       status = excluded.status,
       capacity = excluded.capacity,
       memo = excluded.memo,
       updated_at = datetime('now')`,
    [date, timeSlot, status, capacity, memo ?? null]
  );
}

export async function upsertRange(
  startDate: string,
  endDate: string,
  timeSlot: TimeSlot,
  status: CalendarStatus,
  capacity: number,
  memo?: string
): Promise<void> {
  const start = new Date(startDate + "T00:00:00+09:00");
  const end = new Date(endDate + "T23:59:59+09:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const iso =
      kst.getUTCFullYear() + "-" +
      String(kst.getUTCMonth() + 1).padStart(2, "0") + "-" +
      String(kst.getUTCDate()).padStart(2, "0");
    await upsert(iso, timeSlot, status, capacity, memo);
  }
}

export function remove(date: string, timeSlot: TimeSlot): Promise<void> {
  return execute("DELETE FROM calendar_days WHERE date = ? AND time_slot = ?", [date, timeSlot]);
}

export async function countActiveReservationsOnSlot(date: string, timeSlot: TimeSlot): Promise<number> {
  const expiredExcludeClause = `
    NOT (
      rs.reservation_status = 'awaiting_deposit'
      AND EXISTS (
        SELECT 1 FROM payments p
        WHERE p.reservation_id = rs.id
          AND p.payment_status = 'pending'
          AND p.payment_due_date IS NOT NULL
          AND p.payment_due_date < datetime('now')
      )
    )
  `;
  let query: string;
  let params: unknown[];
  if (timeSlot === "all_day") {
    query = `SELECT COUNT(*) as c FROM reservations rs
             WHERE rs.desired_date = ?
               AND rs.reservation_status IN ('received','awaiting_deposit','awaiting_admin_check','confirmed')
               AND ${expiredExcludeClause}`;
    params = [date];
  } else {
    query = `SELECT COUNT(*) as c FROM reservations rs
             WHERE rs.desired_date = ?
               AND (rs.time_slot = ? OR rs.time_slot = 'all_day')
               AND rs.reservation_status IN ('received','awaiting_deposit','awaiting_admin_check','confirmed')
               AND ${expiredExcludeClause}`;
    params = [date, timeSlot];
  }
  const row = await queryRow<{ c: number | string }>(query, params);
  return Number(row?.c ?? 0);
}
