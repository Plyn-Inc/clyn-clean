"use client";

import { useEffect, useState } from "react";
import type { CalendarStatus } from "@/lib/types";
import { CALENDAR_STATUS_LABEL } from "@/lib/types";
import { toKSTDateString, getMonthRangeKST } from "@/lib/utils";

// 슬롯 뷰 타입 (API 응답과 일치)
interface SlotView {
  date: string;
  timeSlot: string;
  status: CalendarStatus;
  effectiveStatus: CalendarStatus;
  capacity: number;
  bookedCount: number;
  remaining: number;
  memo: string | null;
}
interface DaySlotView {
  date: string;
  allDay: SlotView | null;
  morning: SlotView;
  afternoon: SlotView;
}

const STATUS_BG: Record<CalendarStatus, string> = {
  available: "bg-[var(--mint-soft)] text-[var(--mint)]",
  closed: "bg-[var(--sand-deep)] text-[#A3A096]",
  consult_required: "bg-[#FBE9D3] text-[var(--amber)]",
  off: "bg-[#F0EDE9] text-[#CFCDC2]",
};

type SlotTarget = "all_day" | "morning" | "afternoon";

export default function AdminCalendarPage() {
  const todayKST = toKSTDateString(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [days, setDays] = useState<Record<string, DaySlotView>>({});
  const [loading, setLoading] = useState(true);
  const [loadKey, setLoadKey] = useState(0);

  // 선택된 날짜+슬롯
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState<SlotTarget>("all_day");

  // 설정 패널 값
  const [statusChoice, setStatusChoice] = useState<CalendarStatus>("available");
  const [capacityInput, setCapacityInput] = useState("1");
  const [memo, setMemo] = useState("");
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const { year, month } = cursor;

  useEffect(() => {
    let cancelled = false;
    const { start, end } = getMonthRangeKST(year, month);
    fetch(`/api/admin/calendar?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((data: { days: DaySlotView[] }) => {
        if (cancelled) return;
        const map: Record<string, DaySlotView> = {};
        for (const d of data.days ?? []) map[d.date] = d;
        setDays(map);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month, loadKey]);

  // 캘린더 셀 계산
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }

  function getSlot(dateStr: string, slot: "morning" | "afternoon"): SlotView {
    const day = days[dateStr];
    if (!day) return { date: dateStr, timeSlot: slot, status: "available", effectiveStatus: "available", capacity: 1, bookedCount: 0, remaining: 1, memo: null };
    return slot === "morning" ? day.morning : day.afternoon;
  }

  async function applySettings() {
    if (!selectedDate) { setMsg({ type: "err", text: "날짜를 선택해주세요." }); return; }
    const capacity = Number(capacityInput);
    if (!Number.isFinite(capacity) || capacity < 0) { setMsg({ type: "err", text: "예약 가능 건수는 0 이상이어야 합니다." }); return; }

    setApplying(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          timeSlot: targetSlot,
          status: statusChoice,
          capacity,
          memo: memo || undefined,
        }),
      });
      if (res.ok) {
        setMsg({ type: "ok", text: `${selectedDate} ${targetSlot === "all_day" ? "전체" : targetSlot === "morning" ? "오전" : "오후"} 설정이 적용되었습니다.` });
        setLoading(true);
        setLoadKey((k) => k + 1);
      } else {
        const data = await res.json();
        setMsg({ type: "err", text: data.error || "적용 중 오류가 발생했습니다." });
      }
    } catch {
      setMsg({ type: "err", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setApplying(false);
    }
  }

  const currentDay = selectedDate ? days[selectedDate] : null;

  return (
    <div>
      <h1 className="font-display text-xl font-bold">캘린더 관리</h1>
      <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
        날짜를 클릭해 선택한 뒤 오른쪽 패널에서 슬롯(전체·오전·오후)과 상태를 설정합니다.
      </p>

      {msg && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_300px]">
        {/* 캘린더 */}
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between">
            <button onClick={() => { setCursor((c) => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }); setSelectedDate(null); }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] hover:bg-[var(--sand-deep)]">‹</button>
            <p className="font-display text-lg font-bold">{year}년 {month + 1}월</p>
            <button onClick={() => { setCursor((c) => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }); setSelectedDate(null); }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] hover:bg-[var(--sand-deep)]">›</button>
          </div>

          <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-[var(--ink-soft)]">
            {["일","월","화","수","목","금","토"].map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>

          <div className={`grid grid-cols-7 gap-1 ${loading ? "opacity-40" : ""}`}>
            {cells.map((dateStr, idx) => {
              if (!dateStr) return <div key={idx} />;
              const isPast = dateStr < todayKST;
              const isSelected = selectedDate === dateStr;
              const day = days[dateStr];
              const morningSlot = getSlot(dateStr, "morning");
              const afternoonSlot = getSlot(dateStr, "afternoon");
              const dayNum = parseInt(dateStr.slice(8), 10);

              return (
                <button key={dateStr} onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`rounded-xl p-1 text-center transition ${isSelected ? "ring-2 ring-[var(--navy)] ring-offset-1" : ""} ${isPast ? "opacity-40" : "hover:bg-[var(--sand-deep)]"}`}>
                  <p className="text-xs font-bold text-[var(--ink)]">{dayNum}</p>
                  <div className={`mt-0.5 rounded text-[9px] font-medium py-0.5 ${STATUS_BG[morningSlot.effectiveStatus]}`}>
                    오전 {morningSlot.remaining}/{morningSlot.capacity}
                  </div>
                  <div className={`mt-0.5 rounded text-[9px] font-medium py-0.5 ${STATUS_BG[afternoonSlot.effectiveStatus]}`}>
                    오후 {afternoonSlot.remaining}/{afternoonSlot.capacity}
                  </div>
                  {day?.allDay && (
                    <div className={`mt-0.5 rounded text-[9px] py-0.5 ${STATUS_BG[day.allDay.effectiveStatus]}`}>전체</div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-soft)]">
            {(Object.keys(STATUS_BG) as CalendarStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className={`inline-block h-2.5 w-2.5 rounded ${STATUS_BG[s].split(" ")[0]}`} />
                {CALENDAR_STATUS_LABEL[s]}
              </span>
            ))}
            <span>| 잔여/총건수</span>
          </div>
        </div>

        {/* 설정 패널 */}
        <div className="space-y-4">
          {/* 선택된 날짜 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="text-sm font-semibold">선택된 날짜</p>
            {!selectedDate ? (
              <p className="mt-2 text-xs text-[var(--ink-soft)]">캘린더에서 날짜를 클릭하세요.</p>
            ) : (
              <>
                <p className="mt-2 text-sm font-bold">{selectedDate}</p>
                {currentDay && (
                  <div className="mt-3 space-y-1.5 rounded-lg bg-[var(--sand-deep)] p-3 text-xs">
                    <p>오전: {CALENDAR_STATUS_LABEL[currentDay.morning.effectiveStatus]} ({currentDay.morning.remaining}/{currentDay.morning.capacity}건)</p>
                    <p>오후: {CALENDAR_STATUS_LABEL[currentDay.afternoon.effectiveStatus]} ({currentDay.afternoon.remaining}/{currentDay.afternoon.capacity}건)</p>
                    {currentDay.allDay && <p>전체차단: {CALENDAR_STATUS_LABEL[currentDay.allDay.effectiveStatus]}</p>}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 슬롯 선택 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="mb-3 text-sm font-semibold">적용할 슬롯</p>
            <div className="space-y-1.5">
              {([["all_day", "날짜 전체 (오전+오후 동시 적용)"], ["morning", "오전만"], ["afternoon", "오후만"]] as const).map(([slot, label]) => (
                <label key={slot} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${targetSlot === slot ? "bg-[var(--navy)] text-white" : "hover:bg-[var(--sand-deep)]"}`}>
                  <input type="radio" name="slot" value={slot} checked={targetSlot === slot} onChange={() => setTargetSlot(slot)} className="accent-white" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* 상태 선택 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="mb-3 text-sm font-semibold">설정할 상태</p>
            <div className="space-y-1.5">
              {(Object.entries(CALENDAR_STATUS_LABEL) as [CalendarStatus, string][]).map(([key, label]) => (
                <label key={key} className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${statusChoice === key ? "bg-[var(--navy)] text-white" : "hover:bg-[var(--sand-deep)]"}`}>
                  <input type="radio" name="status" value={key} checked={statusChoice === key} onChange={() => setStatusChoice(key)} className="accent-white" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* 예약 가능 건수 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="mb-1.5 text-sm font-semibold">예약 가능 건수</p>
            <p className="mb-2 text-xs text-[var(--ink-soft)]">슬롯별 최대 예약 건수입니다. 초과 시 자동 마감.</p>
            <input type="number" min={0} value={capacityInput} onChange={(e) => setCapacityInput(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
          </div>

          {/* 메모 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="mb-1.5 text-sm font-semibold">관리자 메모 (선택)</p>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 팀 일정 조정"
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
          </div>

          <button onClick={applySettings} disabled={applying || !selectedDate}
            className="w-full rounded-full bg-[var(--navy)] py-3 text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-50">
            {applying ? "적용 중..." : "설정 적용"}
          </button>
        </div>
      </div>
    </div>
  );
}
