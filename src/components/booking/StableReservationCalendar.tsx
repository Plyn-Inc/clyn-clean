"use client";

import { useEffect, useMemo, useState } from "react";
import { bookingMaxDate, bookingMaxMonth, bookingMinMonth } from "@/lib/booking-window";
import { getMonthRangeKST, toKSTDateString } from "@/lib/utils";
import type { PublicSlotStatus } from "@/lib/types";
import type { SelectedSlot } from "./ReservationCalendar";

interface PublicSlot {
  publicStatus: PublicSlotStatus;
  selectable: boolean;
  consultRequired: boolean;
}
interface PublicDay {
  date: string;
  isSaturday: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  isSonEomneunDay: boolean;
  allDayBlocked?: boolean;
  morning: PublicSlot;
  afternoon: PublicSlot;
}

type MonthCursor = { year: number; month: number };
type MonthDays = Record<string, PublicDay>;

interface MonthCacheEntry {
  days: MonthDays;
  cachedAt: number;
}

const MONTH_CACHE_MAX_AGE_MS = 60000;
const monthCache = new Map<string, MonthCacheEntry>();
const monthRequests = new Map<string, Promise<MonthDays>>();

function monthKey(cursor: MonthCursor): string {
  return `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`;
}

function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const date = new Date(cursor.year, cursor.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function readCachedMonth(cursor: MonthCursor): MonthDays | null {
  const key = monthKey(cursor);
  const cached = monthCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > MONTH_CACHE_MAX_AGE_MS) {
    monthCache.delete(key);
    return null;
  }
  return cached.days;
}

function requestMonth(cursor: MonthCursor): Promise<MonthDays> {
  const key = monthKey(cursor);
  const inFlight = monthRequests.get(key);
  if (inFlight) return inFlight;

  const { start, end } = getMonthRangeKST(cursor.year, cursor.month);
  const baseRequest = (async () => {
    const response = await fetch(`/api/calendar?start=${start}&end=${end}`);
    if (!response.ok) throw new Error(`calendar ${response.status}`);
    const data = (await response.json()) as { days?: PublicDay[] };
    if (!Array.isArray(data.days)) throw new Error("calendar days missing");

    const next: MonthDays = {};
    for (const day of data.days) next[day.date] = day;
    monthCache.set(key, { days: next, cachedAt: Date.now() });
    return next;
  })();

  const request = baseRequest.finally(() => {
    monthRequests.delete(key);
  });
  monthRequests.set(key, request);
  return request;
}

function prefetchMonth(cursor: MonthCursor) {
  const key = monthKey(cursor);
  if (readCachedMonth(cursor) || monthRequests.has(key)) return;
  void requestMonth(cursor).catch(() => undefined);
}

const MAX_AUTO_RETRIES = 2;
const RETRY_DELAY_MS = 1200;
const RECOVERY_RETRY_DELAY_MS = 10000;
const slotClass: Record<PublicSlotStatus, string> = {
  "예약가능": "bg-[#E3F5EE] text-[#1FA37A] hover:bg-[#1FA37A] hover:text-white",
  "예약진행 중": "bg-[#FBE9D3] text-[#C77C1E] cursor-not-allowed",
  "예약완료": "bg-[#EEF0F3] text-[#9AA3AF] cursor-not-allowed",
};
const label: Record<PublicSlotStatus, string> = {
  "예약가능": "가능",
  "예약진행 중": "진행중",
  "예약완료": "완료",
};
const unknownClass = "border border-dashed border-[var(--line)] bg-white text-[#B8C0CB] cursor-not-allowed";

export default function StableReservationCalendar({
  onSelectSlot,
  onSelectDate,
  onSelectConsultDate,
  selectedSlot,
  selectedDate,
  dateOnly = false,
}: {
  onSelectSlot: (slot: SelectedSlot) => void;
  onSelectDate?: (date: string) => void;
  onSelectConsultDate: (date: string) => void;
  selectedSlot?: SelectedSlot | null;
  selectedDate?: string | null;
  dateOnly?: boolean;
}) {
  const today = useMemo(() => toKSTDateString(new Date()), []);
  const maxDate = useMemo(() => bookingMaxDate(), []);
  const minMonth = useMemo(() => bookingMinMonth(), []);
  const maxMonth = useMemo(() => bookingMaxMonth(), []);
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const [days, setDays] = useState<Record<string, PublicDay>>({});
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const target = cursor;
    const cached = readCachedMonth(target);
    const minIndex = minMonth.year * 12 + minMonth.month;
    const maxIndex = maxMonth.year * 12 + maxMonth.month;

    function prefetchNeighbors() {
      for (const delta of [-1, 1] as const) {
        const neighbor = shiftMonth(target, delta);
        const index = neighbor.year * 12 + neighbor.month;
        if (index >= minIndex && index <= maxIndex) prefetchMonth(neighbor);
      }
    }

    if (cached) {
      setDays(cached);
      setLoading(false);
      setStatusError(false);
    } else {
      setLoading(true);
      setStatusError(false);
    }

    // 다음/이전 달은 사용자가 누르기 전에 백그라운드에서 준비한다.
    prefetchNeighbors();

    async function load(attempt: number) {
      if (!cancelled && !readCachedMonth(target)) {
        setLoading(true);
        if (attempt === 0) setStatusError(false);
      }
      try {
        const next = await requestMonth(target);
        if (cancelled) return;
        setDays(next);
        setStatusError(false);
        setLoading(false);
        prefetchNeighbors();
      } catch {
        if (cancelled) return;
        if (attempt < MAX_AUTO_RETRIES) {
          retryTimer = setTimeout(() => void load(attempt + 1), RETRY_DELAY_MS * (attempt + 1));
          return;
        }

        // 이미 받은 월 데이터가 있으면 화면은 즉시 유지하고 뒤에서만 복구한다.
        if (!readCachedMonth(target)) {
          setStatusError(true);
          setLoading(false);
        }
        retryTimer = setTimeout(() => void load(0), RECOVERY_RETRY_DELAY_MS);
      }
    }

    // 캐시가 있으면 즉시 보여주고, 같은 요청으로 최신 상태만 백그라운드 갱신한다.
    void load(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [cursor, minMonth, maxMonth]);

  const monthLabel = `${cursor.year}년 ${cursor.month + 1}월`;
  const firstDay = new Date(cursor.year, cursor.month, 1).getDay();
  const lastDate = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cursorIndex = cursor.year * 12 + cursor.month;
  const minIndex = minMonth.year * 12 + minMonth.month;
  const maxIndex = maxMonth.year * 12 + maxMonth.month;

  function moveMonth(delta: number) {
    const nextIndex = cursorIndex + delta;
    if (nextIndex < minIndex || nextIndex > maxIndex) return;

    const target = shiftMonth(cursor, delta);
    const cached = readCachedMonth(target);
    if (cached) {
      setDays(cached);
      setLoading(false);
      setStatusError(false);
    } else {
      setLoading(true);
    }
    setCursor(target);
  }

  function selectSlot(date: string, timeSlot: "morning" | "afternoon", slot?: PublicSlot) {
    if (!slot) return;
    if (slot.consultRequired) return onSelectConsultDate(date);
    if (slot.selectable) onSelectSlot({ date, timeSlot });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-4 shadow-sm md:p-5">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="이전 달" disabled={cursorIndex <= minIndex} onClick={() => moveMonth(-1)} className="h-9 w-9 rounded-lg border border-[var(--line)] disabled:opacity-30">‹</button>
        <div className="text-center">
          <p className="font-display text-base font-bold">{monthLabel}</p>
          <p className="mt-0.5 min-h-4 text-[10px] text-[var(--ink-soft)]">
            {loading ? "예약 상태 확인 중..." : statusError ? "예약 상태 연결을 복구 중입니다" : ""}
          </p>
        </div>
        <button type="button" aria-label="다음 달" disabled={cursorIndex >= maxIndex} onClick={() => moveMonth(1)} className="h-9 w-9 rounded-lg border border-[var(--line)] disabled:opacity-30">›</button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-[var(--ink-soft)]">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => <div key={day} className="py-1">{day}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstDay }).map((_, index) => <div key={`blank-${index}`} />)}
        {Array.from({ length: lastDate }).map((_, index) => {
          const dateNumber = index + 1;
          const date = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(dateNumber).padStart(2, "0")}`;
          const day = days[date];
          const unavailableByWindow = date < today || date > maxDate;
          const morning = day?.morning;
          const afternoon = day?.afternoon;
          const known = Boolean(morning && afternoon);
          const dateSelectable = Boolean(known && !day?.allDayBlocked && morning?.selectable && afternoon?.selectable);
          const consult = Boolean(morning?.consultRequired || afternoon?.consultRequired);
          const dateStatus: PublicSlotStatus = dateSelectable ? "예약가능" : morning?.publicStatus === "예약진행 중" || afternoon?.publicStatus === "예약진행 중" ? "예약진행 중" : "예약완료";
          const dateColor = day?.isHoliday || day?.isSunday ? "text-[#D14343]" : day?.isSaturday ? "text-[#2E90D9]" : "text-[var(--ink)]";

          if (unavailableByWindow) return <div key={date} className="rounded-lg p-1 text-center opacity-30"><p className="text-xs">{dateNumber}</p></div>;

          return (
            <div key={date} className="rounded-lg p-1 text-center">
              <p className={`mb-0.5 text-xs font-medium ${dateColor}`}>{dateNumber}</p>
              <div className="mb-1 flex h-[6px] items-center justify-center">{day?.isSonEomneunDay ? <span className="h-1.5 w-1.5 rounded-full bg-[#2E90D9]" /> : null}</div>
              {dateOnly ? (
                <button
                  type="button"
                  disabled={!known || (!dateSelectable && !consult)}
                  onClick={() => consult ? onSelectConsultDate(date) : dateSelectable ? onSelectDate?.(date) : undefined}
                  className={`min-h-[54px] w-full rounded-md text-[10px] font-medium ${known ? slotClass[dateStatus] : unknownClass} ${selectedDate === date ? "ring-2 ring-[var(--navy)]" : ""}`}
                >날짜<span className="block text-[9px]">{known ? (consult ? "상담" : label[dateStatus]) : "확인중"}</span></button>
              ) : (
                <>
                  {(["morning", "afternoon"] as const).map((timeSlot) => {
                    const slot = timeSlot === "morning" ? morning : afternoon;
                    const selected = selectedSlot?.date === date && selectedSlot.timeSlot === timeSlot;
                    return (
                      <button
                        key={timeSlot}
                        type="button"
                        disabled={!slot || (!slot.selectable && !slot.consultRequired)}
                        onClick={() => selectSlot(date, timeSlot, slot)}
                        className={`${timeSlot === "morning" ? "mb-0.5" : ""} min-h-[36px] w-full rounded-md text-[10px] font-medium ${slot ? slotClass[slot.publicStatus] : unknownClass} ${selected ? "ring-2 ring-[var(--navy)]" : ""}`}
                      >{timeSlot === "morning" ? "오전" : "오후"}<span className="block text-[9px]">{slot ? (slot.consultRequired ? "상담" : label[slot.publicStatus]) : "확인중"}</span></button>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}