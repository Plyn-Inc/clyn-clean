/**
 * 특수일(공휴일·손없는날) — Production source of truth.
 *
 * 판정 원칙:
 *   - 공휴일 / 손없는날 : Supabase `special_days` 캐시에서만 읽는다.
 *   - 토 / 일           : 서버가 날짜로 직접 계산한다 (DB 불필요).
 *   - 데이터가 없는 날짜 : "일반일"로 간주하지 않고 SpecialDayNotSyncedError를 던진다.
 *   - KASI OpenAPI는 배치 동기화에서만 호출한다 (고객 요청 경로에서 호출 금지).
 *
 * 코드 내 정적 목록(special-days.ts)은 Production 판정에 사용하지 않으며
 * 개발/테스트/backfill 보조 용도로만 남아 있다.
 */
import * as repo from "@/database/repositories/special-day-repository";
import { withTransaction, getDatabaseBackend } from "@/database/connection";
import { getSetting, setSetting } from "./settings";
import { DATE_ADJUSTMENT_AMOUNT } from "./types";
import { bookingMinDate, bookingMaxDate, BOOKING_WINDOW_DAYS } from "./booking-window";
import { fetchHolidays, fetchLunarDay, fetchLunarMonth, isKasiConfigured, KasiUnavailableError } from "./kasi";
// backfill 보조 — KASI를 쓸 수 없는 환경(로컬/테스트)에서만 사용한다
import { getSpecialDayMeta as staticMeta, isYearSupported as staticYearSupported } from "./special-days";

/** 손없는날 = 음력 9·10·19·20·29·30일 */
const SON_LUNAR_DAYS = new Set([9, 10, 19, 20, 29, 30]);

/**
 * generator fallback 허용 여부.
 *
 * Production(NODE_ENV=production 또는 PostgreSQL backend)에서는 절대 허용하지 않는다.
 * KASI 키가 없으면 명시적으로 실패시켜 잘못된 데이터가 운영에 쓰이지 않게 한다.
 */
export function isGeneratorFallbackAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (getDatabaseBackend() === "postgres") return false;
  return true;
}

export class SpecialDayNotSyncedError extends Error {
  code = "SPECIAL_DAY_NOT_SYNCED";
  constructor(dateStr: string) {
    super(
      `${dateStr}의 공휴일 정보가 아직 준비되지 않았습니다. 잠시 후 다시 시도하시거나 상담으로 문의해주세요.`
    );
    this.name = "SpecialDayNotSyncedError";
  }
}

export interface SpecialDayInfo {
  date: string;
  isWeekend: boolean;
  isSaturday: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isSonEomneunDay: boolean;
  /** 고객 캘린더 표시용 배지. 가격과 연결한 문구는 담지 않는다 */
  customerBadge: string | null;
  /** 데이터 출처 (kasi | generator | manual) */
  source: string;
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function toInfo(dateStr: string, row: repo.SpecialDayRow): SpecialDayInfo {
  const wd = weekdayOf(dateStr);
  const isHoliday = row.is_holiday === 1;
  const isSon = row.is_son_eomneun_day === 1;
  return {
    date: dateStr,
    isWeekend: wd === 0 || wd === 6,
    isSaturday: wd === 6,
    isSunday: wd === 0,
    isHoliday,
    holidayName: row.holiday_name,
    isSonEomneunDay: isSon,
    customerBadge: isHoliday ? row.holiday_name : isSon ? "손없는날" : null,
    source: row.source,
  };
}

/**
 * 단일 날짜의 특수일 정보를 DB 캐시에서 조회한다.
 * 캐시에 없으면 SpecialDayNotSyncedError를 던진다 (일반일로 간주하지 않는다).
 */
export async function getSpecialDay(dateStr: string): Promise<SpecialDayInfo> {
  const row = await repo.findSpecialDay(dateStr);
  if (!row) throw new SpecialDayNotSyncedError(dateStr);
  // Production에서는 generator 데이터를 신뢰하지 않는다 (fail-closed)
  if (!isGeneratorFallbackAllowed() && row.source === "generator") {
    throw new SpecialDayNotSyncedError(dateStr);
  }
  return toInfo(dateStr, row);
}

/** 범위 조회 — 캐시에 있는 날짜만 Map으로 반환 (캘린더 렌더링용) */
export async function getSpecialDayRange(
  start: string,
  end: string
): Promise<Map<string, SpecialDayInfo>> {
  const rows = await repo.findSpecialDaysInRange(start, end);
  const allowGenerator = isGeneratorFallbackAllowed();
  return new Map(
    rows
      .filter((r) => allowGenerator || r.source !== "generator")
      .map((r) => [r.date, toInfo(r.date, r)])
  );
}

/**
 * 날짜 조건 가격 보정액.
 *
 * 토/일/공휴일/손없는날 중 하나라도 해당하면 30,000원을 한 번만 가산한다.
 * 조건이 겹쳐도 누적하지 않는다.
 */
export async function getDateAdjustmentFromStore(
  dateStr: string | null | undefined
): Promise<number> {
  if (!dateStr) return 0;
  const info = await getSpecialDay(dateStr);
  const applies = info.isWeekend || info.isHoliday || info.isSonEomneunDay;
  return applies ? DATE_ADJUSTMENT_AMOUNT : 0;
}

/** 캐시가 해당 날짜를 커버하는지 확인 (throw 없이) */
export async function isDateSynced(dateStr: string): Promise<boolean> {
  const row = await repo.findSpecialDay(dateStr);
  if (!row) return false;
  if (!isGeneratorFallbackAllowed() && row.source === "generator") return false;
  return true;
}

// ---------------------------------------------------------------------------
// 동기화
// ---------------------------------------------------------------------------

export interface SyncResult {
  from: string;
  to: string;
  synced: number;
  source: "kasi" | "generator";
  skippedManual: number;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/**
 * KASI OpenAPI로 특수일을 동기화한다.
 *
 * 배치/관리자 트리거에서만 호출한다. 고객 요청 경로에서 호출하지 않는다.
 * KASI_SERVICE_KEY가 없으면 오프라인 generator 데이터로 backfill한다
 * (개발/테스트 환경에서 예약 흐름이 막히지 않도록).
 */
export async function syncSpecialDays(options?: {
  from?: string;
  days?: number;
  force?: boolean;
}): Promise<SyncResult> {
  const from = options?.from ?? bookingMinDate();
  // 예약 가능 기간(365일)보다 넉넉히 확보한다
  const days = options?.days ?? BOOKING_WINDOW_DAYS + 60;
  const to = addDays(from, days);

  if (!isKasiConfigured()) {
    if (!isGeneratorFallbackAllowed()) {
      // Production에서는 generator로 대체하지 않고 명시적으로 실패한다.
      throw new KasiUnavailableError(
        "KASI_SERVICE_KEY가 설정되지 않았습니다. 운영 환경에서는 오프라인 데이터로 대체하지 않습니다."
      );
    }
    return syncFromGenerator(from, to);
  }
  return syncFromKasi(from, to, options?.force === true);
}

/** 개발/테스트 전용 backfill */
async function syncFromGenerator(from: string, to: string): Promise<SyncResult> {
  const manualDates = new Set((await repo.listManualOverrides()).map((r) => r.date));
  let synced = 0;
  let skippedManual = 0;

  await withTransaction(async () => {
    for (let cur = from; cur <= to; cur = addDays(cur, 1)) {
      if (manualDates.has(cur)) { skippedManual++; continue; }
      if (!staticYearSupported(cur)) continue;
      const meta = staticMeta(cur);
      await repo.upsertSpecialDay({
        date: cur,
        isHoliday: meta.isHoliday,
        holidayName: meta.holidayName,
        isSonEomneunDay: meta.isSonEomneunDay,
        source: "generator",
      });
      synced++;
    }
    await setSetting("special_days_synced_through", to);
  });

  return { from, to, synced, source: "generator", skippedManual };
}

/** 월 목록 생성 */
function monthsBetween(from: string, to: string): [number, number][] {
  const start = new Date(`${from}T00:00:00Z`);
  const endD = new Date(`${to}T00:00:00Z`);
  const out: [number, number][] = [];
  for (
    let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    d <= endD;
    d.setUTCMonth(d.getUTCMonth() + 1)
  ) {
    out.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
  }
  return out;
}

/** 제한된 동시성으로 실행 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * KASI 동기화.
 *
 * 1) 응답을 먼저 전부 메모리에 받아 검증한다 (KASI 오류 시 기존 캐시를 훼손하지 않음)
 * 2) 검증을 통과한 결과만 트랜잭션으로 일괄 적용한다
 * 3) 음력은 월 단위 조회를 우선하고, 실패한 월만 일 단위로 폴백한다
 */
async function syncFromKasi(from: string, to: string, force: boolean): Promise<SyncResult> {
  const manualDates = new Set((await repo.listManualOverrides()).map((r) => r.date));
  const months = monthsBetween(from, to);

  // --- 1) 공휴일: 월 단위 조회 (bounded concurrency) ---
  const holidayMaps = await mapWithConcurrency(months, 4, async ([y, m]) => fetchHolidays(y, m));
  const holidays = new Map<string, string>();
  for (const list of holidayMaps) for (const h of list) holidays.set(h.date, h.name);

  // --- 2) 음력: 월 단위 우선, 실패 시 해당 월만 일 단위 폴백 ---
  const lunar = new Map<string, number>();
  await mapWithConcurrency(months, 4, async ([y, m]) => {
    try {
      const monthMap = await fetchLunarMonth(y, m);
      if (monthMap.size > 0) {
        for (const [d, lunDay] of monthMap) lunar.set(d, lunDay);
        return;
      }
    } catch {
      // 월 단위 실패 → 일 단위 폴백
    }
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const dates: string[] = [];
    for (let d = 1; d <= last; d++) {
      dates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    await mapWithConcurrency(dates, 6, async (ds) => {
      const lunDay = await fetchLunarDay(ds);
      if (lunDay !== null) lunar.set(ds, lunDay);
    });
  });

  // --- 3) 검증: 모든 대상 날짜의 음력 정보가 확보됐는지 ---
  const targets: string[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) {
    if (manualDates.has(cur)) continue;
    targets.push(cur);
  }
  const missing = targets.filter((d) => !lunar.has(d));
  if (missing.length > 0) {
    // 부분 결과를 DB에 쓰지 않는다 (기존 정상 캐시 보존)
    throw new KasiUnavailableError(
      `KASI 음력 정보 ${missing.length}건을 가져오지 못했습니다 (예: ${missing[0]}). 기존 캐시를 유지합니다.`
    );
  }

  // --- 4) 검증 통과분만 트랜잭션으로 일괄 적용 ---
  let synced = 0;
  await withTransaction(async () => {
    for (const cur of targets) {
      if (!force) {
        const existing = await repo.findSpecialDay(cur);
        // 이미 kasi 소스로 최신이면 건너뛴다 (incremental)
        if (existing && existing.source === "kasi") {
          const sameHoliday = (existing.is_holiday === 1) === holidays.has(cur);
          const sameSon = (existing.is_son_eomneun_day === 1) === SON_LUNAR_DAYS.has(lunar.get(cur)!);
          if (sameHoliday && sameSon) continue;
        }
      }
      await repo.upsertSpecialDay({
        date: cur,
        isHoliday: holidays.has(cur),
        holidayName: holidays.get(cur) ?? null,
        isSonEomneunDay: SON_LUNAR_DAYS.has(lunar.get(cur)!),
        source: "kasi",
      });
      synced++;
    }
    await setSetting("special_days_synced_through", to);
    await setSetting("special_days_last_sync_at", new Date().toISOString());
    await setSetting("special_days_last_kasi_sync_at", new Date().toISOString());
  });

  return {
    from,
    to,
    synced,
    source: "kasi",
    skippedManual: manualDates.size,
  };
}

/**
 * 증분 동기화 — 운영 중 매일 실행용.
 *
 * 전체 425일을 다시 조회하지 않고,
 *   - 캐시가 아직 커버하지 못한 tail 구간
 *   - 근접 30일 refresh (임시공휴일 등 변경 반영)
 * 만 조회한다.
 */
export async function syncSpecialDaysIncremental(): Promise<SyncResult> {
  const targetEnd = addDays(bookingMinDate(), BOOKING_WINDOW_DAYS + 60);
  const covered = await repo.maxCoveredDate();

  // 근접 30일은 항상 refresh (임시공휴일 반영)
  const refreshFrom = bookingMinDate();
  const refreshTo = addDays(refreshFrom, 30);

  if (!covered || covered < refreshTo) {
    // 캐시가 거의 없으면 전체 동기화
    return syncSpecialDays();
  }

  // 1) 근접 구간 refresh
  const near = await syncSpecialDays({ from: refreshFrom, days: 30, force: true });
  // 2) tail 구간만 추가
  if (covered < targetEnd) {
    const tailFrom = addDays(covered, 1);
    const tailDays = Math.round(
      (new Date(`${targetEnd}T00:00:00Z`).getTime() - new Date(`${tailFrom}T00:00:00Z`).getTime()) / 86400000
    );
    if (tailDays > 0) {
      const tail = await syncSpecialDays({ from: tailFrom, days: tailDays });
      return {
        from: refreshFrom,
        to: targetEnd,
        synced: near.synced + tail.synced,
        source: tail.source,
        skippedManual: near.skippedManual + tail.skippedManual,
      };
    }
  }
  return { ...near, to: targetEnd };
}

/**
 * 예약 가능 기간의 캐시 상태를 점검한다.
 *
 * Production 정상 조건:
 *   1. 예약 기간의 모든 날짜가 존재
 *   2. 각 행의 source가 kasi 또는 manual
 *      → generator 행이 하나라도 있으면 정상으로 보지 않는다
 *   3. 마지막 KASI 성공 동기화가 너무 오래되지 않았을 것
 *
 * count === expected만으로 정상 처리하지 않는다.
 */
export const KASI_SYNC_STALE_HOURS = 48;

export interface CoverageReport {
  covered: boolean;
  from: string;
  to: string;
  expected: number;
  actual: number;
  missing: number;
  bySource: Record<string, number>;
  /** generator 데이터가 섞여 있는지 (Production 부적합) */
  hasGeneratorRows: boolean;
  /** 마지막 KASI 성공 동기화가 오래됐는지 */
  stale: boolean;
  syncedThrough: string;
  lastSyncAt: string;
  lastKasiSyncAt: string;
  /** 정상이 아닐 때의 사유 */
  issues: string[];
}

export async function checkCoverage(): Promise<CoverageReport> {
  const from = bookingMinDate();
  const to = bookingMaxDate();
  const expected =
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
    ) + 1;

  const actual = await repo.countSpecialDaysInRange(from, to);
  const bySource = await repo.countBySourceInRange(from, to);
  const generatorRows = bySource.generator ?? 0;
  const lastKasiSyncAt = (await getSetting("special_days_last_kasi_sync_at")) || "";

  const productionMode = !isGeneratorFallbackAllowed();
  const issues: string[] = [];

  if (actual < expected) issues.push(`${expected - actual}일 누락`);

  let hasGeneratorRows = generatorRows > 0;
  if (productionMode && hasGeneratorRows) {
    issues.push(`오프라인 generator 데이터 ${generatorRows}건 — KASI 동기화 필요`);
  } else if (!productionMode) {
    // 개발/테스트에서는 generator를 정상으로 본다
    hasGeneratorRows = false;
  }

  let stale = false;
  if (productionMode) {
    if (!lastKasiSyncAt) {
      stale = true;
      issues.push("KASI 성공 동기화 기록 없음");
    } else {
      const ageH = (Date.now() - new Date(lastKasiSyncAt).getTime()) / 3600000;
      if (ageH > KASI_SYNC_STALE_HOURS) {
        stale = true;
        issues.push(`마지막 KASI 동기화 후 ${Math.floor(ageH)}시간 경과`);
      }
    }
  }

  return {
    covered: issues.length === 0,
    from,
    to,
    expected,
    actual,
    missing: Math.max(expected - actual, 0),
    bySource,
    hasGeneratorRows,
    stale,
    syncedThrough: (await getSetting("special_days_synced_through")) || "",
    lastSyncAt: (await getSetting("special_days_last_sync_at")) || "",
    lastKasiSyncAt,
    issues,
  };
}

/**
 * 개별 날짜가 고객에게 제공 가능한 상태인지 판정한다 (fail-closed).
 *
 * Production에서 generator 행은 신뢰하지 않는다.
 */
export async function assertDateUsable(dateStr: string): Promise<void> {
  const row = await repo.findSpecialDay(dateStr);
  if (!row) throw new SpecialDayNotSyncedError(dateStr);
  if (!isGeneratorFallbackAllowed() && row.source === "generator") {
    throw new SpecialDayNotSyncedError(dateStr);
  }
}

/** 관리자 manual override */
export async function setManualSpecialDay(input: {
  date: string;
  isHoliday: boolean;
  holidayName: string | null;
  isSonEomneunDay: boolean;
  adminNote?: string;
}): Promise<void> {
  await repo.upsertSpecialDay({
    date: input.date,
    isHoliday: input.isHoliday,
    holidayName: input.holidayName,
    isSonEomneunDay: input.isSonEomneunDay,
    source: "manual",
    adminNote: input.adminNote ?? null,
  });
}

export function listManualOverrides() {
  return repo.listManualOverrides();
}

/** manual override 해제 — 다음 동기화 때 KASI 값으로 복구된다 */
export function clearManualSpecialDay(date: string) {
  return repo.deleteSpecialDay(date);
}
