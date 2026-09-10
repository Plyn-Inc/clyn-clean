// ---------------------------------------------------------------------------
// 유틸리티 함수
// ---------------------------------------------------------------------------

export function generateReservationCode(): string {
  // 한국 시간 기준으로 날짜 생성
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear().toString().slice(2);
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RES-${y}${m}${d}-${rand}`;
}

export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const suffix = Date.now().toString(36).slice(-5);
  return base ? `${base}-${suffix}` : suffix;
}

export function formatCurrency(amount: number): string {
  return amount.toLocaleString("ko-KR") + "원";
}

/**
 * 한국 시간(KST, UTC+9) 기준 오늘 날짜를 YYYY-MM-DD 형식으로 반환합니다.
 * toISOString().slice(0,10) 는 UTC 기준이므로 자정 전후 9시간 동안 날짜가 틀립니다.
 */
export function todayKST(): string {
  return toKSTDateString(new Date());
}

/**
 * Date 객체를 한국 시간(KST) 기준 YYYY-MM-DD 문자열로 변환합니다.
 * 예약일, 캘린더 날짜, 과거날짜 판정에 반드시 이 함수를 사용하세요.
 */
export function toKSTDateString(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * YYYY-MM-DD 문자열이 오늘(KST) 이전 날짜인지 확인합니다.
 */
export function isPastDateKST(dateStr: string): boolean {
  return dateStr < todayKST();
}

/**
 * YYYY-MM-DD 형식 유효성 검사
 */
export function isValidDateFormat(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

/**
 * 날짜가 너무 먼 미래인지 확인 (기본 365일)
 */
export function isTooFarFuture(dateStr: string, maxDays = 365): boolean {
  const today = todayKST();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + maxDays);
  return dateStr > toKSTDateString(maxDate);
}

/** @deprecated 신규 코드에서는 todayKST()를 사용하세요 */
export function todayISO(): string {
  return todayKST();
}

/**
 * 현재 시각에서 N시간 후의 ISO 문자열을 반환합니다 (UTC, DB 저장용).
 * 입금 기한 등 시각까지 필요한 경우에만 사용합니다.
 */
export function addHoursISO(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

/**
 * KST 기준 월의 첫날/마지막날을 반환합니다.
 * 캘린더 범위 계산에 사용합니다.
 */
export function getMonthRangeKST(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

// ---------------------------------------------------------------------------
// 최소 고객정보 검증 (서버측)
// ---------------------------------------------------------------------------

/**
 * 연락처를 숫자만 남긴 형태로 정규화한다.
 * 하이픈/공백/국가번호(+82)를 처리한다.
 */
export function normalizePhone(raw: string): string {
  let digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+82")) digits = "0" + digits.slice(3);
  else if (digits.startsWith("82") && digits.length > 10) digits = "0" + digits.slice(2);
  return digits.replace(/\D/g, "");
}

/**
 * 한국 휴대폰/일반전화 형식 검증.
 * 서버에서도 반드시 호출한다 (클라이언트 검증만으로 처리하지 않음).
 */
export function isValidKoreanPhone(raw: string): boolean {
  const d = normalizePhone(raw);
  if (!d.startsWith("0")) return false;
  if (d.length < 9 || d.length > 11) return false;
  // 휴대폰 01X-XXXX-XXXX / 지역번호 0XX-XXX(X)-XXXX
  return /^01[0-9]\d{7,8}$/.test(d) || /^0(2|[3-6][1-5])\d{6,8}$/.test(d);
}

/** 010-1234-5678 형태로 표시용 포맷 */
export function formatPhone(raw: string): string {
  const d = normalizePhone(raw);
  if (/^01[0-9]\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^01[0-9]\d{7}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.startsWith("02")) {
    return d.length === 10 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  }
  if (d.length >= 10) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return d;
}

/** 관리자 화면 마스킹 표시용 (010-****-5678) */
export function maskPhone(raw: string): string {
  const f = formatPhone(raw);
  const parts = f.split("-");
  if (parts.length !== 3) return f;
  return `${parts[0]}-${"*".repeat(parts[1].length)}-${parts[2]}`;
}

export interface WorkArea {
  sido: string;
  sigungu: string;
  dong: string;
}

/** 작업지역(시/도 · 시군구 · 행정동)이 모두 입력됐는지 검증 */
export function isValidWorkArea(area: Partial<WorkArea> | null | undefined): boolean {
  return !!(area?.sido?.trim() && area?.sigungu?.trim() && area?.dong?.trim());
}

/** "서울특별시 강남구 역삼동" 형태로 합친다 */
export function formatWorkArea(area: Partial<WorkArea> | null | undefined): string {
  return [area?.sido, area?.sigungu, area?.dong].filter(Boolean).join(" ").trim();
}
