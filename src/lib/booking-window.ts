/**
 * 예약 가능 기간 — 단일 원천.
 *
 * 서버 API(/api/reservations, /api/quote, /api/calendar)와
 * 클라이언트(ReservationCalendar, BookingForm)가 모두 이 모듈을 사용한다.
 * 기간을 바꿀 때는 BOOKING_WINDOW_DAYS만 수정한다.
 */
import { todayKST, toKSTDateString } from "./utils";

/** 오늘로부터 예약 가능한 최대 일수 */
export const BOOKING_WINDOW_DAYS = 365;

/** 예약 가능한 첫 날 (오늘, KST) */
export function bookingMinDate(): string {
  return todayKST();
}

/** 예약 가능한 마지막 날 (오늘 + BOOKING_WINDOW_DAYS, KST) */
export function bookingMaxDate(): string {
  const today = todayKST();
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + BOOKING_WINDOW_DAYS);
  return toKSTDateString(d);
}

/** 해당 날짜가 예약 가능 기간 안에 있는지 */
export function isWithinBookingWindow(dateStr: string): boolean {
  if (!dateStr) return false;
  return dateStr >= bookingMinDate() && dateStr <= bookingMaxDate();
}

/** 예약 가능한 마지막 "월" (캘린더 이동 상한) */
export function bookingMaxMonth(): { year: number; month: number } {
  const [y, m] = bookingMaxDate().split("-").map(Number);
  return { year: y, month: m - 1 }; // month는 0-based (Date와 동일)
}

/** 예약 가능한 첫 "월" (캘린더 이동 하한) */
export function bookingMinMonth(): { year: number; month: number } {
  const [y, m] = bookingMinDate().split("-").map(Number);
  return { year: y, month: m - 1 };
}

/** 범위 밖 날짜에 대한 공통 오류 메시지 */
export function outOfWindowMessage(): string {
  return `예약은 오늘부터 ${BOOKING_WINDOW_DAYS}일 이내 날짜만 선택할 수 있습니다.`;
}
