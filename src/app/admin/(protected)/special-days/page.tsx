"use client";

import { useEffect, useState } from "react";

interface Coverage {
  covered: boolean; from: string; to: string;
  expected: number; actual: number; missing: number;
  bySource: Record<string, number>;
  hasGeneratorRows: boolean; stale: boolean;
  syncedThrough: string; lastSyncAt: string; lastKasiSyncAt: string;
  issues: string[];
}
interface Override {
  date: string; is_holiday: number; holiday_name: string | null;
  is_son_eomneun_day: number; admin_note: string | null;
}

export default function AdminSpecialDaysPage() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [date, setDate] = useState("");
  const [isHoliday, setIsHoliday] = useState(true);
  const [holidayName, setHolidayName] = useState("임시공휴일");
  const [isSon, setIsSon] = useState(false);
  const [note, setNote] = useState("");

  function load() {
    fetch("/api/admin/special-days")
      .then((r) => r.json())
      .then((d) => { setCoverage(d.coverage); setOverrides(d.overrides ?? []); })
      .catch(() => {});
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/special-days")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setCoverage(d.coverage); setOverrides(d.overrides ?? []); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function post(body: Record<string, unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/special-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) { setMsg({ type: "ok", text: okText }); load(); }
      else setMsg({ type: "err", text: d.error ?? "처리 실패" });
    } catch {
      setMsg({ type: "err", text: "네트워크 오류" });
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-xl font-bold">공휴일 / 손없는날 관리</h1>
      <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
        한국천문연구원(KASI) OpenAPI를 동기화해 캐시로 사용합니다. 고객 요청 시 실시간 호출하지 않습니다.
      </p>

      {msg && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-sm font-semibold">동기화 상태</p>
        {coverage ? (
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="예약 가능 기간" value={`${coverage.from} ~ ${coverage.to}`} />
            <Row label="캐시 상태" value={coverage.covered ? "정상" : "점검 필요"} />
            <Row label="보유 / 필요" value={`${coverage.actual} / ${coverage.expected}일`} />
            <Row
              label="데이터 출처"
              value={Object.entries(coverage.bySource).map(([k, v]) => `${k} ${v}건`).join(" · ") || "-"}
            />
            <Row label="동기화 완료 범위" value={coverage.syncedThrough || "-"} />
            <Row
              label="마지막 KASI 동기화"
              value={coverage.lastKasiSyncAt ? new Date(coverage.lastKasiSyncAt).toLocaleString("ko-KR") : "없음"}
            />
          </dl>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">불러오는 중...</p>
        )}
        {coverage && !coverage.covered && (
          <div className="mt-3 rounded-lg bg-[#FBE9D3] px-4 py-3 text-xs leading-relaxed text-[var(--amber)]">
            <p className="font-semibold">동기화가 필요합니다.</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {coverage.issues.map((i) => <li key={i}>{i}</li>)}
            </ul>
            <p className="mt-1.5">해당 날짜는 고객이 예약하거나 확정 견적을 받을 수 없습니다.</p>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={() => post({ action: "sync" }, "동기화를 완료했습니다.")}
            className="rounded-lg bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "처리 중..." : "동기화 실행"}
          </button>
          <button disabled={busy} onClick={() => post({ action: "sync", mode: "incremental" }, "증분 동기화를 완료했습니다.")}
            className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
            증분 동기화
          </button>
          <button disabled={busy} onClick={() => post({ action: "sync", force: true }, "전체 재동기화를 완료했습니다.")}
            className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
            전체 재동기화
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-sm font-semibold">수동 지정 (임시공휴일 등)</p>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          수동 지정한 날짜는 이후 동기화가 덮어쓰지 않습니다.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold">날짜</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold">명칭</label>
            <input value={holidayName} onChange={(e) => setHolidayName(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-4 sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={isHoliday} onChange={(e) => setIsHoliday(e.target.checked)} className="h-4 w-4" />
              공휴일
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={isSon} onChange={(e) => setIsSon(e.target.checked)} className="h-4 w-4" />
              손없는날
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-semibold">메모</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 국무회의 의결"
              className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
          </div>
        </div>
        <button disabled={busy || !date}
          onClick={() => post({ action: "manual", date, isHoliday, holidayName, isSonEomneunDay: isSon, adminNote: note }, "수동 지정을 저장했습니다.")}
          className="mt-3 rounded-lg bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          저장
        </button>
      </section>

      <section className="mt-6">
        <p className="mb-3 text-sm font-semibold">수동 지정 목록 ({overrides.length})</p>
        {overrides.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">수동 지정된 날짜가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {overrides.map((o) => (
              <div key={o.date} className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white p-4">
                <div>
                  <p className="text-sm font-semibold">{o.date} · {o.holiday_name ?? "-"}</p>
                  <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                    {o.is_holiday ? "공휴일" : ""}{o.is_holiday && o.is_son_eomneun_day ? " · " : ""}
                    {o.is_son_eomneun_day ? "손없는날" : ""}
                    {o.admin_note ? ` · ${o.admin_note}` : ""}
                  </p>
                </div>
                <button disabled={busy}
                  onClick={() => post({ action: "clear", date: o.date }, "수동 지정을 해제했습니다.")}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium disabled:opacity-50">
                  해제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--ink-soft)]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
