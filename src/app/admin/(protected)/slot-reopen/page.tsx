"use client";

import { useEffect, useState } from "react";
import { todayKST } from "@/lib/utils";

interface Override {
  date: string;
  time_slot: string;
  is_open: number;
  reason: string | null;
}

/**
 * 사이청소 보호 날짜의 슬롯 재개방 관리.
 *
 * 사이청소는 종일 작업이라 해당 날짜의 오전·오후가 함께 막힌다.
 * 일정이 일찍 끝나는 등 예외 상황에서 관리자가 특정 슬롯만 다시 열 수 있다.
 * 실제 예약 점유는 재개방보다 우선하므로, 이미 찬 슬롯은 열리지 않는다.
 */
export default function AdminSlotReopenPage() {
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const start = todayKST();
  const end = (() => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 120);
    return d.toISOString().slice(0, 10);
  })();

  function load() {
    fetch(`/api/admin/slot-reopen?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((d) => {
        setBlockedDates(d.allDayBlockedDates ?? []);
        setOverrides(d.overrides ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const d = await fetch(`/api/admin/slot-reopen?start=${start}&end=${end}`).then((r) => r.json());
        if (cancelled) return;
        setBlockedDates(d.allDayBlockedDates ?? []);
        setOverrides(d.overrides ?? []);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [start, end]);

  async function setSlot(date: string, timeSlot: "morning" | "afternoon", isOpen: boolean) {
    setMsg(null);
    const res = await fetch("/api/admin/slot-reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, timeSlot, isOpen }),
    });
    if (res.ok) { setMsg({ type: "ok", text: "저장했습니다." }); load(); }
    else setMsg({ type: "err", text: "저장 실패" });
  }

  function isOpen(date: string, slot: string) {
    return overrides.some((o) => o.date === date && o.time_slot === slot && o.is_open === 1);
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold">사이청소 슬롯 관리</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
          사이청소 예약이 있는 날짜는 종일 작업으로 오전·오후가 함께 막힙니다.
          일정이 일찍 끝나는 등 예외 상황에서만 특정 슬롯을 다시 열어주세요.
          이미 다른 예약이 찬 슬롯은 재개방해도 열리지 않습니다.
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      {blockedDates.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)]">
          현재 사이청소로 보호 중인 날짜가 없습니다.
        </p>
      ) : (
        <div className="space-y-2">
          {blockedDates.sort().map((date) => (
            <div key={date} className="rounded-xl border border-[var(--line)] bg-white p-4">
              <p className="text-sm font-semibold">{date}</p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">사이청소 예약으로 종일 보호 중</p>
              <div className="mt-3 flex gap-2">
                {(["morning", "afternoon"] as const).map((slot) => {
                  const open = isOpen(date, slot);
                  return (
                    <button
                      key={slot}
                      onClick={() => void setSlot(date, slot, !open)}
                      className={`min-h-[40px] flex-1 rounded-lg border px-3 text-xs font-medium ${
                        open
                          ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]"
                          : "border-[var(--line)] text-[var(--ink-soft)]"
                      }`}
                    >
                      {slot === "morning" ? "오전" : "오후"} · {open ? "재개방됨" : "보호 중"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
