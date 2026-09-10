"use client";

import { useEffect, useMemo, useState } from "react";
import { toKSTDateString, getMonthRangeKST } from "@/lib/utils";
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
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [days, setDays] = useState<Record<string, PublicDay>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const { start, end } = getMonthRangeKST(cursor.year, cursor.month + 1);
    fetch(`/api/calendar?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((data: { days?: PublicDay[] }) => {
        if (cancelled) return;
        const map: Record<string, PublicDay> = {};
        for (const d of data.days ?? []) map[d.date] = d;
        setDays(map);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [cursor]);

  const monthLabel = `${cursor.year}년 ${cursor.month + 1}월`;
  const firstDay = new Date(cursor.year, cursor.month, 1);
  const lastDate = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leadingBlanks = firstDay.getDay();

  function moveMonth(delta: number) {
    setLoading(true);
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function getSlot(dateStr: string, slot: "morning" | "afternoon"): PublicSlot {
    const day = days[dateStr];
    if (!day) return { publicStatus: "예약완료", selectable: false, consultRequired: false };
    return slot === "morning" ? day.morning : day.afternoon;
  }

  function handleSlotClick(dateStr: string, slot: "morning" | "afternoon", view: PublicSlot) {
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
          aria-label="이전 달"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-sm hover:bg-[var(--sand-deep)]"
        >
          ‹
        </button>
        <p className="font-display text-base font-bold">{monthLabel}</p>
        <button
          type="button"
          onClick={() => moveMonth(1)}
          aria-label="다음 달"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-sm hover:bg-[var(--sand-deep)]"
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

      {loading ? (
        <div className="py-16 text-center text-sm text-[var(--ink-soft)]">불러오는 중...</div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: lastDate }).map((_, i) => {
            const dateNum = i + 1;
            const dateStr = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(dateNum).padStart(2, "0")}`;
            const isPast = dateStr < todayKST;
            const morning = getSlot(dateStr, "morning");
            const afternoon = getSlot(dateStr, "afternoon");
            const isSelMorning = selectedSlot?.date === dateStr && selectedSlot.timeSlot === "morning";
            const isSelAfternoon = selectedSlot?.date === dateStr && selectedSlot.timeSlot === "afternoon";

            if (isPast) {
              return (
                <div key={dateStr} className="rounded-lg p-1 text-center opacity-35">
                  <p className="mb-1 text-xs text-[#CFCDC2]">{dateNum}</p>
                </div>
              );
            }

            return (
              <div key={dateStr} className="rounded-lg p-1 text-center">
                <p className="mb-1 text-xs font-medium text-[var(--ink)]">{dateNum}</p>

                <button
                  type="button"
                  disabled={!morning.selectable && !morning.consultRequired}
                  onClick={() => handleSlotClick(dateStr, "morning", morning)}
                  aria-label={`${dateStr} 오전 ${morning.publicStatus}`}
                  className={`mb-0.5 min-h-[36px] w-full rounded-md py-1 text-[10px] font-medium leading-tight transition ${SLOT_STYLE[morning.publicStatus]} ${isSelMorning ? SLOT_SELECTED : ""}`}
                >
                  오전
                  <span className="block text-[9px] opacity-80">
                    {morning.consultRequired ? "상담" : SHORT_LABEL[morning.publicStatus]}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!afternoon.selectable && !afternoon.consultRequired}
                  onClick={() => handleSlotClick(dateStr, "afternoon", afternoon)}
                  aria-label={`${dateStr} 오후 ${afternoon.publicStatus}`}
                  className={`min-h-[36px] w-full rounded-md py-1 text-[10px] font-medium leading-tight transition ${SLOT_STYLE[afternoon.publicStatus]} ${isSelAfternoon ? SLOT_SELECTED : ""}`}
                >
                  오후
                  <span className="block text-[9px] opacity-80">
                    {afternoon.consultRequired ? "상담" : SHORT_LABEL[afternoon.publicStatus]}
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
