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

export async function countDirectActiveReservationsOnSlot(
  date: string,
  timeSlot: "morning" | "afternoon"
): Promise<number> {
  const row = await queryRow<{ c: number | string }>(
    `SELECT COUNT(*) as c FROM reservations rs
      WHERE rs.desired_date = ?
        AND rs.time_slot = ?
        AND rs.reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')
        AND NOT (
          rs.reservation_status IN ('awaiting_deposit','approved_awaiting_deposit')
          AND EXISTS (
            SELECT 1 FROM payments p
             WHERE p.reservation_id = rs.id
               AND p.payment_status = 'pending'
               AND p.payment_due_date IS NOT NULL
               AND p.payment_due_date < datetime('now')
          )
        )`,
    [date, timeSlot]
  );
  return Number(row?.c ?? 0);
}

export async function countActiveReservationsOnSlot(date: string, timeSlot: TimeSlot): Promise<number> {
  // 입금기한(계좌 안내 후 24시간)이 지난 미입금 예약은 슬롯을 더 이상 점유하지 않는다.
  // 예약 row는 삭제하지 않고 슬롯만 자동 해제한다 (요구사항 25·26).
  const expiredExcludeClause = `
    NOT (
      rs.reservation_status IN ('awaiting_deposit','approved_awaiting_deposit')
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
               AND rs.reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')
               AND ${expiredExcludeClause}`;
    params = [date];
  } else {
    query = `SELECT COUNT(*) as c FROM reservations rs
             WHERE rs.desired_date = ?
               AND (rs.time_slot = ? OR rs.time_slot = 'all_day')
               AND rs.reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')
               AND ${expiredExcludeClause}`;
    params = [date, timeSlot];
  }
  const row = await queryRow<{ c: number | string }>(query, params);
  return Number(row?.c ?? 0);
}

/**
 * 해당 날짜/슬롯에 입금확인 완료(confirmed/completed) 예약이 있는지 확인한다.
 * 고객 공개상태를 "예약완료"로 표시할지 판단하는 데 사용한다.
 */
export async function hasConfirmedReservationOnSlot(
  date: string,
  timeSlot: "morning" | "afternoon"
): Promise<boolean> {
  const row = await queryRow<{ c: number }>(
    `SELECT COUNT(*) as c FROM reservations rs
      WHERE rs.desired_date = ?
        AND (rs.time_slot = ? OR rs.time_slot = 'all_day')
        AND rs.reservation_status IN ('confirmed','completed')`,
    [date, timeSlot]
  );
  return Number(row?.c ?? 0) > 0;
}

/**
 * 범위 내 슬롯별 활성 예약 수를 한 번에 집계한다 (N+1 제거).
 *
 * 날짜마다 countActiveReservationsOnSlot을 반복 호출하지 않고
 * GROUP BY로 한 번에 가져온다. 월 조회 query 수가 날짜 수에 비례하지 않는다.
 *
 * 입금기한이 지난 미입금 예약은 제외한다 (countActiveReservationsOnSlot와 동일 규칙).
 */
export async function aggregateActiveReservationsInRange(
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const rows = await queryRows<{ desired_date: string; time_slot: string; c: number }>(
    `SELECT rs.desired_date, rs.time_slot, COUNT(*) as c
       FROM reservations rs
      WHERE rs.desired_date >= ? AND rs.desired_date <= ?
        AND rs.reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')
        AND NOT (
          rs.reservation_status IN ('awaiting_deposit','approved_awaiting_deposit')
          AND EXISTS (
            SELECT 1 FROM payments p
             WHERE p.reservation_id = rs.id
               AND p.payment_status = 'pending'
               AND p.payment_due_date IS NOT NULL
               AND p.payment_due_date < datetime('now')
          )
        )
      GROUP BY rs.desired_date, rs.time_slot`,
    [startDate, endDate]
  );
  // key: "YYYY-MM-DD|time_slot"
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.desired_date}|${r.time_slot}`, Number(r.c));
  return map;
}

/**
 * 범위 내 입금확인 완료(confirmed/completed) 예약을 슬롯별로 집계한다.
 * 공개상태 "예약완료" 판정용. 날짜마다 반복 조회하지 않는다.
 */
export async function aggregateConfirmedReservationsInRange(
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  const rows = await queryRows<{ desired_date: string; time_slot: string; c: number }>(
    `SELECT rs.desired_date, rs.time_slot, COUNT(*) as c
       FROM reservations rs
      WHERE rs.desired_date >= ? AND rs.desired_date <= ?
        AND rs.reservation_status IN ('confirmed','completed')
      GROUP BY rs.desired_date, rs.time_slot`,
    [startDate, endDate]
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.desired_date}|${r.time_slot}`, Number(r.c));
  return map;
}

// ---------------------------------------------------------------------------
// 사이청소 all_day 보호 / 슬롯 재개방 override
// ---------------------------------------------------------------------------

export interface SlotReopenOverrideRow {
  id: number;
  date: string;
  time_slot: string;
  is_open: number;
  reason: string | null;
  source_reservation_id: number | null;
  updated_by_admin_id: number | null;
  updated_at: string;
}

/** 범위 내 재개방 override를 "YYYY-MM-DD|slot" 키 Map으로 반환 */
export async function findReopenOverridesInRange(
  start: string,
  end: string
): Promise<Map<string, SlotReopenOverrideRow>> {
  const rows = await queryRows<SlotReopenOverrideRow>(
    `SELECT * FROM calendar_slot_reopen_overrides WHERE date >= ? AND date <= ?`,
    [start, end]
  );
  return new Map(rows.map((r) => [`${r.date}|${r.time_slot}`, r]));
}

export function findReopenOverride(
  date: string,
  timeSlot: string
): Promise<SlotReopenOverrideRow | undefined> {
  return queryRow<SlotReopenOverrideRow>(
    `SELECT * FROM calendar_slot_reopen_overrides WHERE date = ? AND time_slot = ?`,
    [date, timeSlot]
  );
}

/**
 * 관리자 슬롯 재개방 지정.
 *
 * 실제 예약 점유가 override보다 우선한다. 이 레코드는 "사이청소 all_day 보호"만
 * 해제할 뿐, 이미 확정된 예약이 있는 슬롯을 열지 않는다.
 */
export function upsertReopenOverride(input: {
  date: string;
  timeSlot: "morning" | "afternoon";
  isOpen: boolean;
  reason?: string | null;
  sourceReservationId?: number | null;
  adminId?: number | null;
}): Promise<void> {
  return execute(
    `INSERT INTO calendar_slot_reopen_overrides
       (date, time_slot, is_open, reason, source_reservation_id, updated_by_admin_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (date, time_slot) DO UPDATE SET
       is_open = EXCLUDED.is_open,
       reason = EXCLUDED.reason,
       source_reservation_id = EXCLUDED.source_reservation_id,
       updated_by_admin_id = EXCLUDED.updated_by_admin_id,
       updated_at = datetime('now')`,
    [
      input.date,
      input.timeSlot,
      input.isOpen ? 1 : 0,
      input.reason ?? null,
      input.sourceReservationId ?? null,
      input.adminId ?? null,
    ]
  );
}

export function deleteReopenOverride(date: string, timeSlot: string): Promise<void> {
  return execute(
    `DELETE FROM calendar_slot_reopen_overrides WHERE date = ? AND time_slot = ?`,
    [date, timeSlot]
  );
}

/**
 * 범위 내 사이청소(all_day) 예약이 날짜 보호를 적용 중인 날짜를 반환한다.
 *
 * 실제 작업시간과 별개로 오전·오후를 우선 보호하고, 관리자가 필요한 슬롯만 재개방한다.
 */
export async function findAllDayBlockedDates(start: string, end: string): Promise<Set<string>> {
  const rows = await queryRows<{ desired_date: string }>(
    `SELECT DISTINCT rs.desired_date
       FROM reservations rs
      WHERE rs.desired_date >= ? AND rs.desired_date <= ?
        AND rs.time_slot = 'all_day'
        AND rs.reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')
        AND NOT (
          rs.reservation_status IN ('awaiting_deposit','approved_awaiting_deposit')
          AND EXISTS (
            SELECT 1 FROM payments p
             WHERE p.reservation_id = rs.id
               AND p.payment_status = 'pending'
               AND p.payment_due_date IS NOT NULL
               AND p.payment_due_date < datetime('now')
          )
        )`,
    [start, end]
  );
  return new Set(rows.map((r) => r.desired_date));
}
