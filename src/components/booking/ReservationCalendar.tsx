"use client";

import { useEffect, useMemo, useState } from "react";
import { toKSTDateString, getMonthRangeKST } from "@/lib/utils";
import { bookingMaxDate, bookingMinMonth, bookingMaxMonth } from "@/lib/booking-window";
import type { PublicSlotStatus } from "@/lib/types";

/**
 * 공개 예약 캘린더.
 *
 * 고객에게 예약 수량을 노출하지 않는다 (요구사항 21·33).
 * 서버 공개 API(/api/calendar)는 capacity/remaining/bookedCount를 반환하지 않으며,
 * 이 컴포넌트는 publicStatus / selectable만 사용한다.
 */
interface PublicSlot {
  publicStatus: PublicSlotStatus;
  selectable: boolean;
  consultRequired: boolean;
}
interface PublicDay {
  date: string;
  /** 특별일 시각 구분용 — 가격 가산과 연결한 문구는 표시하지 않는다 */
  isSaturday: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  isSonEomneunDay: boolean;
  badge: string | null;
  morning: PublicSlot;
  afternoon: PublicSlot;
}

export type SelectedSlot = { date: string; timeSlot: "morning" | "afternoon" };

/** 공개상태별 슬롯 스타일 — 수량 대신 상태 문구만 표시한다 */
const SLOT_STYLE: Record<PublicSlotStatus, string> = {
  "예약가능": "bg-[var(--mint-soft)] text-[var(--mint)] hover:bg-[var(--mint-bright)] hover:text-white cursor-pointer",
  "예약진행 중": "bg-[#FBE9D3] text-[var(--amber)] cursor-not-allowed",
  "예약완료": "bg-[var(--sand-deep)] text-[#A3A096] cursor-not-allowed",
};

/** 캘린더 칸에 들어갈 짧은 라벨 (수량 없음) */
const SHORT_LABEL: Record<PublicSlotStatus, string> = {
  "예약가능": "가능",
  "예약진행 중": "진행중",
  "예약완료": "완료",
};

/** 서버 데이터가 없는 슬롯 — 예약완료가 아니라 "정보 없음"으로 구분한다 */
const SLOT_UNKNOWN = "bg-white text-[#C7CDD6] border border-dashed border-[var(--line)] cursor-not-allowed";

const SLOT_SELECTED = "ring-2 ring-[var(--navy)] ring-offset-1";

export default function ReservationCalendar({
  onSelectSlot,
  onSelectConsultDate,
  selectedSlot,
}: {
  onSelectSlot: (slot: SelectedSlot) => void;
  onSelectConsultDate: (date: string) => void;
  selectedSlot?: SelectedSlot | null;
}) {
  const todayKST = useMemo(() => toKSTDateString(new Date()), []);
  // 예약 가능 범위 — booking-window 단일 원천
  const maxDate = useMemo(() => bookingMaxDate(), []);
  const minMonth = useMemo(() => bookingMinMonth(), []);
  const maxMonth = useMemo(() => bookingMaxMonth(), []);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [days, setDays] = useState<Record<string, PublicDay>>({});
  // loading / success / error 를 명확히 분리한다.
  // 에러 상태에서 빈 데이터를 정상 캘린더처럼 렌더링하지 않는다.
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const { start, end } = getMonthRangeKST(cursor.year, cursor.month + 1);
    fetch(`/api/calendar?start=${start}&end=${end}`)
      .then(async (r) => {
        // HTTP 오류를 정상 응답처럼 처리하지 않는다
        if (!r.ok) throw new Error(`calendar API ${r.status}`);
        const data = (await r.json()) as { days?: PublicDay[] };
        if (!Array.isArray(data.days)) throw new Error("calendar API: days 배열 없음");
        return data.days;
      })
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, PublicDay> = {};
        for (const d of list) map[d.date] = d;
        setDays(map);
        setStatus("success");
      })
      .catch(() => {
        // fetch 실패 / HTTP 오류 / JSON 파싱 실패 / 비정상 응답
        // → 절대로 "예약완료"로 표시하지 않고 에러 상태로 전환한다
        if (!cancelled) { setDays({}); setStatus("error"); }
      });
    return () => { cancelled = true; };
  }, [cursor, reloadToken]);

  const monthLabel = `${cursor.year}년 ${cursor.month + 1}월`;
  const firstDay = new Date(cursor.year, cursor.month, 1);
  const lastDate = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();

  const cursorIndex = cursor.year * 12 + cursor.month;
  const minIndex = minMonth.year * 12 + minMonth.month;
  const maxIndex = maxMonth.year * 12 + maxMonth.month;
  const canGoPrev = cursorIndex > minIndex;
  const canGoNext = cursorIndex < maxIndex;

  function moveMonth(delta: number) {
    const next = cursorIndex + delta;
    // 예약 가능 기간을 벗어난 월로는 이동할 수 없다
    if (next < minIndex || next > maxIndex) return;
    setStatus("loading");
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  /**
   * 서버가 내려준 슬롯 정보를 반환한다.
   *
   * 데이터가 없으면 null을 반환한다. 절대로 "예약완료"로 대체하지 않는다.
   * (API 실패·미동기화·날짜 누락을 예약완료로 표시하면 고객이 예약 가능한 날을
   *  마감된 것으로 오인한다)
   */
  function getSlot(dateStr: string, slot: "morning" | "afternoon"): PublicSlot | null {
    const day = days[dateStr];
    if (!day) return null;
    return slot === "morning" ? day.morning : day.afternoon;
  }

  function handleSlotClick(dateStr: string, slot: "morning" | "afternoon", view: PublicSlot | null) {
    if (!view) return;
    if (view.consultRequired) { onSelectConsultDate(dateStr); return; }
    if (!view.selectable) return;
    onSelectSlot({ date: dateStr, timeSlot: slot });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-4 shadow-sm md:p-5">
      {/* 월 이동 */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => moveMonth(-1)}
          disabled={!canGoPrev}
          aria-label="이전 달"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-sm hover:bg-[var(--sand-deep)] disabled:cursor-not-allowed disabled:opacity-35"
        >
          ‹
        </button>
        <p className="font-display text-base font-bold">{monthLabel}</p>
        <button
          type="button"
          onClick={() => moveMonth(1)}
          disabled={!canGoNext}
          aria-label="다음 달"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-sm hover:bg-[var(--sand-deep)] disabled:cursor-not-allowed disabled:opacity-35"
        >
          ›
        </button>
      </div>

      {/* 요일 */}
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-medium text-[var(--ink-soft)]">
        {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      {status === "loading" ? (
        <div className="py-16 text-center text-sm text-[var(--ink-soft)]">불러오는 중...</div>
      ) : status === "error" ? (
        <div className="py-14 text-center" role="alert">
          <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
            예약 일정을 불러오지 못했습니다.
            <br />
            잠시 후 다시 시도해주세요.
          </p>
          <button
            type="button"
            onClick={() => { setStatus("loading"); setReloadToken((t) => t + 1); }}
            className="mt-5 min-h-[44px] rounded-full border border-[var(--navy)] px-6 text-sm font-semibold text-[var(--navy)] transition hover:bg-[var(--navy)] hover:text-white"
          >
            다시 불러오기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: lastDate }).map((_, i) => {
            const dateNum = i + 1;
            const dateStr = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(dateNum).padStart(2, "0")}`;
            const isPast = dateStr < todayKST;
            // 예약 가능 최대일 이후는 선택할 수 없다
            const isBeyondWindow = dateStr > maxDate;
            const morning = getSlot(dateStr, "morning");
            const afternoon = getSlot(dateStr, "afternoon");
            const isSelMorning = selectedSlot?.date === dateStr && selectedSlot.timeSlot === "morning";
            const isSelAfternoon = selectedSlot?.date === dateStr && selectedSlot.timeSlot === "afternoon";
            const day = days[dateStr];
            // 날짜 숫자 색으로 토/일/공휴일을 구분한다 (가격 문구 없음)
            const dateColor = day?.isHoliday || day?.isSunday
              ? "text-[var(--rose)]"
              : day?.isSaturday
                ? "text-[var(--navy)]"
                : "text-[var(--ink)]";

            if (isPast || isBeyondWindow) {
              return (
                <div
                  key={dateStr}
                  className="rounded-lg p-1 text-center opacity-35"
                  title={isBeyondWindow ? "예약 가능 기간 이후" : undefined}
                >
                  <p className="mb-1 text-xs text-[#CFCDC2]">{dateNum}</p>
                </div>
              );
            }

            return (
              <div key={dateStr} className="rounded-lg p-1 text-center">
                <p className={`mb-0.5 text-xs font-medium ${dateColor}`}>{dateNum}</p>
                {/* 공휴일명 / 손없는날 배지 — 가격과 무관한 정보성 표시 */}
                {day?.badge ? (
                  <p
                    className={`mb-1 truncate text-[8px] leading-tight ${day.isHoliday ? "text-[var(--rose)]" : "text-[var(--mint)]"}`}
                    title={day.badge}
                  >
                    {day.badge}
                  </p>
                ) : (
                  <p className="mb-1 h-[11px]" aria-hidden />
                )}

                <button
                  type="button"
                  disabled={!morning || (!morning.selectable && !morning.consultRequired)}
                  onClick={() => handleSlotClick(dateStr, "morning", morning)}
                  aria-label={`${dateStr} 오전 ${morning?.publicStatus ?? "정보 없음"}`}
                  className={`mb-0.5 min-h-[36px] w-full rounded-md py-1 text-[10px] font-medium leading-tight transition ${morning ? SLOT_STYLE[morning.publicStatus] : SLOT_UNKNOWN} ${isSelMorning ? SLOT_SELECTED : ""}`}
                >
                  오전
                  <span className="block text-[9px] opacity-80">
                    {!morning ? "-" : morning.consultRequired ? "상담" : SHORT_LABEL[morning.publicStatus]}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!afternoon || (!afternoon.selectable && !afternoon.consultRequired)}
                  onClick={() => handleSlotClick(dateStr, "afternoon", afternoon)}
                  aria-label={`${dateStr} 오후 ${afternoon?.publicStatus ?? "정보 없음"}`}
                  className={`min-h-[36px] w-full rounded-md py-1 text-[10px] font-medium leading-tight transition ${afternoon ? SLOT_STYLE[afternoon.publicStatus] : SLOT_UNKNOWN} ${isSelAfternoon ? SLOT_SELECTED : ""}`}
                >
                  오후
                  <span className="block text-[9px] opacity-80">
                    {!afternoon ? "-" : afternoon.consultRequired ? "상담" : SHORT_LABEL[afternoon.publicStatus]}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 범례 — 3종 공개상태 */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-soft)]">
        <Legend color="bg-[var(--mint-soft)]" label="예약가능" />
        <Legend color="bg-[#FBE9D3]" label="예약진행 중" />
        <Legend color="bg-[var(--sand-deep)]" label="예약완료" />
        <span className="flex items-center gap-1.5">
          <span className="text-[var(--rose)]">●</span> 일요일 · 공휴일
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[var(--navy)]">●</span> 토요일
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[var(--mint)]">●</span> 손없는날
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${color}`} />
      {label}
    </span>
  );
}
