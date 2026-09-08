"use client";

import { useEffect, useMemo, useState } from "react";
import type { CalendarStatus } from "@/lib/types";
import { toKSTDateString, getMonthRangeKST } from "@/lib/utils";

// 서버 API 응답 타입
interface SlotView {
  date: string;
  timeSlot: string;
  status: CalendarStatus;
  effectiveStatus: CalendarStatus;
  remaining: number;
  memo: string | null;
}
interface DaySlot {
  date: string;
  allDay: SlotView | null;
  morning: SlotView;
  afternoon: SlotView;
}

export type SelectedSlot = { date: string; timeSlot: "morning" | "afternoon" };

const STATUS_DAY_STYLE: Record<CalendarStatus, string> = {
  available: "text-[var(--ink)]",
  closed: "text-[#A3A096]",
  consult_required: "text-[var(--amber)]",
  off: "text-[#CFCDC2]",
};

const SLOT_AVAIL = "bg-[var(--mint-soft)] text-[var(--mint)] hover:bg-[var(--mint-bright)] hover:text-white cursor-pointer";
const SLOT_CLOSED = "bg-[var(--sand-deep)] text-[#A3A096] cursor-not-allowed";
const SLOT_CONSULT = "bg-[#FBE9D3] text-[var(--amber)] cursor-pointer";
const SLOT_OFF = "bg-transparent text-[#CFCDC2] cursor-not-allowed line-through";
const SLOT_SELECTED = "ring-2 ring-[var(--navy)] ring-offset-1";

function slotStyle(status: CalendarStatus, isSelected: boolean): string {
  const base =
    status === "available" ? SLOT_AVAIL
    : status === "consult_required" ? SLOT_CONSULT
    : status === "off" ? SLOT_OFF
    : SLOT_CLOSED;
  return `${base} ${isSelected ? SLOT_SELECTED : ""}`;
}

export default function ReservationCalendar({
  onSelectSlot,
  onSelectConsultDate,
}: {
  onSelectSlot: (slot: SelectedSlot) => void;
  onSelectConsultDate: (date: string) => void;
}) {
  const todayKST = useMemo(() => toKSTDateString(new Date()), []);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [days, setDays] = useState<Record<string, DaySlot>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedSlot | null>(null);

  const { year, month } = cursor;

  useEffect(() => {
    let cancelled = false;
    const { start, end } = getMonthRangeKST(year, month);

    fetch(`/api/calendar?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((data: { days: DaySlot[] }) => {
        if (cancelled) return;
        const map: Record<string, DaySlot> = {};
        for (const d of data.days ?? []) map[d.date] = d;
        setDays(map);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month]);

  // 캘린더 셀 계산
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    );
  }

  function getPastSlot(): SlotView {
    return { date: "", timeSlot: "morning", status: "off", effectiveStatus: "off", remaining: 0, memo: null };
  }

  function getSlot(dateStr: string, slot: "morning" | "afternoon"): SlotView {
    if (dateStr < todayKST) return getPastSlot();
    const day = days[dateStr];
    if (!day) {
      // 서버 설정 없는 날짜 → 기본 available
      return { date: dateStr, timeSlot: slot, status: "available", effectiveStatus: "available", remaining: 1, memo: null };
    }
    return slot === "morning" ? day.morning : day.afternoon;
  }

  function handleSlotClick(dateStr: string, slot: "morning" | "afternoon") {
    const view = getSlot(dateStr, slot);
    if (view.effectiveStatus === "available") {
      const newSelected = { date: dateStr, timeSlot: slot };
      setSelected(newSelected);
      onSelectSlot(newSelected);
    } else if (view.effectiveStatus === "consult_required") {
      onSelectConsultDate(dateStr);
    }
  }

  function prevMonth() {
    setCursor((c) => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 });
  }
  function nextMonth() {
    setCursor((c) => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 });
  }

  // 날짜 전체가 off/closed/consult인지 (헤더 색상 결정용)
  function getDayStatus(dateStr: string): CalendarStatus {
    if (dateStr < todayKST) return "off";
    const day = days[dateStr];
    if (!day) return "available";
    // all_day 설정이 있으면 그게 대표 상태
    if (day.allDay) return day.allDay.effectiveStatus;
    // 둘 다 off면 off, 하나라도 available이면 available
    const m = day.morning.effectiveStatus;
    const a = day.afternoon.effectiveStatus;
    if (m === "off" && a === "off") return "off";
    if (m === "available" || a === "available") return "available";
    if (m === "consult_required" || a === "consult_required") return "consult_required";
    return "closed";
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-5 shadow-sm md:p-6">
      {/* 헤더 */}
      <div className="mb-5 flex items-center justify-between">
        <button aria-label="이전 달" onClick={prevMonth}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--sand-deep)]">
          ‹
        </button>
        <p className="font-display text-lg font-bold">{year}년 {month + 1}월</p>
        <button aria-label="다음 달" onClick={nextMonth}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--sand-deep)]">
          ›
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-[var(--ink-soft)]">
        {["일","월","화","수","목","금","토"].map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      {/* 날짜 셀 */}
      <div className={`grid grid-cols-7 gap-1 ${loading ? "opacity-50" : ""}`}>
        {cells.map((dateStr, idx) => {
          if (!dateStr) return <div key={idx} />;

          const dayStatus = getDayStatus(dateStr);
          const morningView = getSlot(dateStr, "morning");
          const afternoonView = getSlot(dateStr, "afternoon");
          const isSelectedMorning = selected?.date === dateStr && selected?.timeSlot === "morning";
          const isSelectedAfternoon = selected?.date === dateStr && selected?.timeSlot === "afternoon";
          const dayNum = parseInt(dateStr.slice(8), 10);

          // all_day 설정(날짜 전체 차단)이면 단순 표시
          const isBlocked = dayStatus === "off";

          return (
            <div key={dateStr} className={`rounded-xl p-1 text-center ${isBlocked ? "opacity-40" : ""}`}>
              {/* 날짜 숫자 */}
              <p className={`mb-0.5 text-xs font-semibold ${STATUS_DAY_STYLE[dayStatus]}`}>{dayNum}</p>

              {/* 오전 슬롯 */}
              <button
                disabled={morningView.effectiveStatus === "off" || morningView.effectiveStatus === "closed"}
                onClick={() => handleSlotClick(dateStr, "morning")}
                className={`mb-0.5 w-full rounded-md py-1 text-[10px] font-medium leading-tight transition ${slotStyle(morningView.effectiveStatus, isSelectedMorning)}`}
              >
                오전
                {morningView.effectiveStatus === "available" && (
                  <span className="block text-[9px] opacity-80">{morningView.remaining}건</span>
                )}
                {morningView.effectiveStatus === "closed" && <span className="block text-[9px]">마감</span>}
                {morningView.effectiveStatus === "off" && <span className="block text-[9px]">-</span>}
                {morningView.effectiveStatus === "consult_required" && <span className="block text-[9px]">상담</span>}
              </button>

              {/* 오후 슬롯 */}
              <button
                disabled={afternoonView.effectiveStatus === "off" || afternoonView.effectiveStatus === "closed"}
                onClick={() => handleSlotClick(dateStr, "afternoon")}
                className={`w-full rounded-md py-1 text-[10px] font-medium leading-tight transition ${slotStyle(afternoonView.effectiveStatus, isSelectedAfternoon)}`}
              >
                오후
                {afternoonView.effectiveStatus === "available" && (
                  <span className="block text-[9px] opacity-80">{afternoonView.remaining}건</span>
                )}
                {afternoonView.effectiveStatus === "closed" && <span className="block text-[9px]">마감</span>}
                {afternoonView.effectiveStatus === "off" && <span className="block text-[9px]">-</span>}
                {afternoonView.effectiveStatus === "consult_required" && <span className="block text-[9px]">상담</span>}
              </button>
            </div>
          );
        })}
      </div>

      {/* 범례 */}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--ink-soft)]">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[var(--mint-soft)]" />예약 가능</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[var(--sand-deep)]" />마감</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-[#FBE9D3]" />상담 필요</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-transparent border border-[#CFCDC2]" />휴무</span>
      </div>

      {/* 선택된 슬롯 안내 */}
      {selected && (
        <div className="mt-3 rounded-lg bg-[var(--mint-soft)] px-3 py-2 text-xs font-medium text-[var(--mint)]">
          📅 {selected.date} {selected.timeSlot === "morning" ? "오전" : "오후"} 선택됨
          <button onClick={() => { setSelected(null); }} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  );
}
