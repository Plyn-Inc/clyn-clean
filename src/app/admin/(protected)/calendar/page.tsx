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
  blockedByAllDay?: boolean;
  reopened?: boolean;
}
interface DaySlotView {
  date: string;
  allDay: SlotView | null;
  morning: SlotView;
  afternoon: SlotView;
}

const STATUS_BG: Record<CalendarStatus, string> = {
  available: "bg-[var(--mint-soft)] text-[var(--mint)] ring-1 ring-inset ring-[#B7E7D8]",
  closed: "bg-[#FDE2E2] text-[#B42318] ring-1 ring-inset ring-[#F2A7A7]",
  consult_required: "bg-[#FFF0D9] text-[#A15C00] ring-1 ring-inset ring-[#F2C078]",
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
  const [loadError, setLoadError] = useState<string | null>(null);
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

  // 날짜 또는 슬롯을 변경하면 오른쪽 설정 패널을 해당 대상의 저장값으로 동기화한다.
  // 이전 날짜에서 입력한 관리자 메모/상태/건수가 다른 날짜로 따라가는 것을 방지한다.
  useEffect(() => {
    setMsg(null);

    if (!selectedDate) {
      setStatusChoice("available");
      setCapacityInput("1");
      setMemo("");
      return;
    }

    const day = days[selectedDate];
    const sameCombinedSettings =
      day &&
      day.morning.status === day.afternoon.status &&
      day.morning.capacity === day.afternoon.capacity &&
      (day.morning.memo ?? "") === (day.afternoon.memo ?? "");
    const selectedSlot =
      targetSlot === "all_day"
        ? day?.allDay ?? (sameCombinedSettings ? day?.morning ?? null : null)
        : targetSlot === "morning"
          ? day?.morning ?? null
          : day?.afternoon ?? null;

    if (!selectedSlot) {
      setStatusChoice("available");
      setCapacityInput("1");
      setMemo("");
      return;
    }

    setStatusChoice(selectedSlot.status);
    setCapacityInput(String(selectedSlot.capacity));
    setMemo(selectedSlot.memo ?? "");
  }, [selectedDate, targetSlot, days]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const { start, end } = getMonthRangeKST(year, month);

    setLoading(true);
    setLoadError(null);

    fetch(`/api/admin/calendar?start=${start}&end=${end}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`admin calendar API ${r.status}`);
        const data = (await r.json()) as { days?: DaySlotView[] };
        if (!Array.isArray(data.days)) throw new Error("admin calendar days missing");
        return data.days;
      })
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, DaySlotView> = {};
        for (const d of list) map[d.date] = d;
        setDays(map);
        setLoadError(null);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled || error instanceof DOMException && error.name === "AbortError") return;
        setLoadError("캘린더 설정을 불러오지 못했습니다. 저장된 설정을 임의로 '예약 가능'으로 표시하지 않습니다.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [year, month, loadKey]);

  // 캘린더 셀 계산
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }

  function getSlot(dateStr: string, slot: "morning" | "afternoon"): SlotView | null {
    const day = days[dateStr];
    if (!day) return null;
    return slot === "morning" ? day.morning : day.afternoon;
  }

  function patchSlot(
    current: SlotView | null,
    date: string,
    timeSlot: "morning" | "afternoon",
    status: CalendarStatus,
    capacity: number,
    nextMemo: string
  ): SlotView {
    const bookedCount = current?.bookedCount ?? 0;
    const remaining = Math.max(capacity - bookedCount, 0);
    let effectiveStatus: CalendarStatus =
      status === "available" && remaining <= 0 ? "closed" : status;
    if (current?.blockedByAllDay && !current?.reopened) effectiveStatus = "closed";

    return {
      date,
      timeSlot,
      status,
      effectiveStatus,
      capacity,
      bookedCount,
      remaining,
      memo: nextMemo || null,
      blockedByAllDay: current?.blockedByAllDay,
      reopened: current?.reopened,
    };
  }

  function patchDayAfterApply(
    current: DaySlotView | undefined,
    date: string,
    slot: SlotTarget,
    status: CalendarStatus,
    capacity: number,
    nextMemo: string
  ): DaySlotView {
    const morning = current?.morning ?? {
      date,
      timeSlot: "morning",
      status: "available" as CalendarStatus,
      effectiveStatus: "available" as CalendarStatus,
      capacity: 1,
      bookedCount: 0,
      remaining: 1,
      memo: null,
    };
    const afternoon = current?.afternoon ?? {
      date,
      timeSlot: "afternoon",
      status: "available" as CalendarStatus,
      effectiveStatus: "available" as CalendarStatus,
      capacity: 1,
      bookedCount: 0,
      remaining: 1,
      memo: null,
    };

    if (slot === "all_day") {
      return {
        date,
        allDay: null,
        morning: patchSlot(morning, date, "morning", status, capacity, nextMemo),
        afternoon: patchSlot(afternoon, date, "afternoon", status, capacity, nextMemo),
      };
    }

    return {
      date,
      allDay: current?.allDay ?? null,
      morning: slot === "morning"
        ? patchSlot(morning, date, "morning", status, capacity, nextMemo)
        : morning,
      afternoon: slot === "afternoon"
        ? patchSlot(afternoon, date, "afternoon", status, capacity, nextMemo)
        : afternoon,
    };
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
        setDays((current) => ({
          ...current,
          [selectedDate]: patchDayAfterApply(
            current[selectedDate],
            selectedDate,
            targetSlot,
            statusChoice,
            capacity,
            memo
          ),
        }));
        setMsg({ type: "ok", text: `${selectedDate} ${targetSlot === "all_day" ? "전체" : targetSlot === "morning" ? "오전" : "오후"} 설정이 적용되었습니다.` });
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
            <button onClick={() => { setLoading(true); setLoadError(null); setCursor((c) => c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }); setSelectedDate(null); }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] hover:bg-[var(--sand-deep)]">‹</button>
            <p className="font-display text-lg font-bold">{year}년 {month + 1}월</p>
            <button onClick={() => { setLoading(true); setLoadError(null); setCursor((c) => c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }); setSelectedDate(null); }}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] hover:bg-[var(--sand-deep)]">›</button>
          </div>

          <div className="mb-2 grid grid-cols-7 text-center text-xs font-medium text-[var(--ink-soft)]">
            {["일","월","화","수","목","금","토"].map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>

          {loadError && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-[#FBEAE5] px-4 py-3 text-xs text-[var(--rose)]" role="alert">
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => setLoadKey((k) => k + 1)}
                className="shrink-0 rounded-full border border-current px-3 py-1.5 font-semibold"
              >
                다시 불러오기
              </button>
            </div>
          )}

          <div className={`grid grid-cols-7 gap-1 ${loading ? "opacity-70" : ""}`}>
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
                  {morningSlot ? (
                    <div className={`mt-0.5 rounded text-[9px] font-medium py-0.5 ${STATUS_BG[morningSlot.effectiveStatus]}`}>
                      오전 {morningSlot.remaining}/{morningSlot.capacity}
                    </div>
                  ) : (
                    <div className="mt-0.5 rounded border border-dashed border-[var(--line)] py-0.5 text-[9px] text-[var(--ink-soft)]">
                      오전 확인중
                    </div>
                  )}
                  {afternoonSlot ? (
                    <div className={`mt-0.5 rounded text-[9px] font-medium py-0.5 ${STATUS_BG[afternoonSlot.effectiveStatus]}`}>
                      오후 {afternoonSlot.remaining}/{afternoonSlot.capacity}
                    </div>
                  ) : (
                    <div className="mt-0.5 rounded border border-dashed border-[var(--line)] py-0.5 text-[9px] text-[var(--ink-soft)]">
                      오후 확인중
                    </div>
                  )}
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
