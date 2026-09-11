import { execute, queryRow, queryRows } from "../connection";

export interface SpecialDayRow {
  date: string;
  is_holiday: number;
  holiday_name: string | null;
  is_son_eomneun_day: number;
  source: "kasi" | "generator" | "manual";
  admin_note: string | null;
  synced_at: string;
  updated_at: string;
}

export function findSpecialDay(date: string): Promise<SpecialDayRow | undefined> {
  return queryRow<SpecialDayRow>("SELECT * FROM special_days WHERE date = ?", [date]);
}

export function findSpecialDaysInRange(start: string, end: string): Promise<SpecialDayRow[]> {
  return queryRows<SpecialDayRow>(
    "SELECT * FROM special_days WHERE date >= ? AND date <= ? ORDER BY date ASC",
    [start, end]
  );
}

/** 해당 범위에서 실제로 저장된 날짜 수 (커버리지 확인용) */
export async function countSpecialDaysInRange(start: string, end: string): Promise<number> {
  const row = await queryRow<{ c: number }>(
    "SELECT COUNT(*) as c FROM special_days WHERE date >= ? AND date <= ?",
    [start, end]
  );
  return Number(row?.c ?? 0);
}

/** 범위 내 source별 집계 */
export async function countBySourceInRange(
  start: string,
  end: string
): Promise<Record<string, number>> {
  const rows = await queryRows<{ source: string; c: number }>(
    "SELECT source, COUNT(*) as c FROM special_days WHERE date >= ? AND date <= ? GROUP BY source",
    [start, end]
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.source] = Number(r.c);
  return out;
}

/** 캐시가 커버하는 마지막 날짜 */
export async function maxCoveredDate(): Promise<string | null> {
  const row = await queryRow<{ d: string | null }>("SELECT MAX(date) as d FROM special_days");
  return row?.d ?? null;
}

export interface UpsertSpecialDayInput {
  date: string;
  isHoliday: boolean;
  holidayName: string | null;
  isSonEomneunDay: boolean;
  source: "kasi" | "generator" | "manual";
  adminNote?: string | null;
}

/**
 * 특수일 upsert.
 *
 * 관리자가 manual로 지정한 날짜는 동기화(kasi/generator)가 덮어쓰지 않는다.
 * manual 지정을 되돌리려면 관리자가 직접 다시 저장해야 한다.
 */
export function upsertSpecialDay(input: UpsertSpecialDayInput): Promise<void> {
  const protectManual = input.source === "manual" ? "" : " AND special_days.source <> 'manual'";
  return execute(
    `INSERT INTO special_days (date, is_holiday, holiday_name, is_son_eomneun_day, source, admin_note, synced_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (date) DO UPDATE SET
       is_holiday = EXCLUDED.is_holiday,
       holiday_name = EXCLUDED.holiday_name,
       is_son_eomneun_day = EXCLUDED.is_son_eomneun_day,
       source = EXCLUDED.source,
       admin_note = EXCLUDED.admin_note,
       synced_at = datetime('now'),
       updated_at = datetime('now')
     WHERE 1 = 1${protectManual}`,
    [
      input.date,
      input.isHoliday ? 1 : 0,
      input.holidayName,
      input.isSonEomneunDay ? 1 : 0,
      input.source,
      input.adminNote ?? null,
    ]
  );
}

export function deleteSpecialDay(date: string): Promise<void> {
  return execute("DELETE FROM special_days WHERE date = ?", [date]);
}

/** 관리자 화면용 — 최근 변경 순 목록 */
export function listManualOverrides(): Promise<SpecialDayRow[]> {
  return queryRows<SpecialDayRow>(
    "SELECT * FROM special_days WHERE source = 'manual' ORDER BY date ASC"
  );
}
