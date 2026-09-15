"use client";

import { useEffect, useState } from "react";

interface ServiceAreaRow {
  sigungu_code: string;
  name: string | null;
  is_enabled: number;
  admin_note: string | null;
}
interface Sido { code: string; name: string }
interface AreaOption { code: string; name: string; level: string }

/**
 * 서비스 가능지역 관리.
 *
 * 시/군/구 단위로 직접 예약 허용 여부를 지정한다.
 * 비활성 지역 고객은 예약 대신 상담 접수로 전환된다.
 */
export default function AdminServiceAreasPage() {
  const [rows, setRows] = useState<ServiceAreaRow[]>([]);
  const [sidoList, setSidoList] = useState<Sido[]>([]);
  const [imported, setImported] = useState(true);
  const [areaCount, setAreaCount] = useState(0);
  const [sido, setSido] = useState("");
  const [sigunguList, setSigunguList] = useState<AreaOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const regionRes = await fetch("/api/regions", { cache: "no-store" });
      if (!regionRes.ok) throw new Error(`행정구역 목록 조회 실패 (${regionRes.status})`);
      const regionData = await regionRes.json();
      setSidoList(regionData.areas ?? []);
      setImported(regionData.imported === true);
      setAreaCount(regionData.areaCount ?? 0);

      if (regionData.imported === true) {
        const adminRes = await fetch("/api/admin/service-areas", { cache: "no-store" });
        if (!adminRes.ok) throw new Error(`서비스 지역 설정 조회 실패 (${adminRes.status})`);
        const adminData = await adminRes.json();
        setRows(adminData.serviceAreas ?? []);
        setAreaCount(adminData.areaCount ?? regionData.areaCount ?? 0);
      } else {
        setRows([]);
      }
    } catch (error) {
      setMsg({
        type: "err",
        text: error instanceof Error ? `지역 목록을 불러오지 못했습니다. ${error.message}` : "지역 목록을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function pickSido(code: string) {
    setSido(code);
    setSigunguList([]);
    if (!code) return;
    const res = await fetch(`/api/regions?parent=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) {
      setMsg({ type: "err", text: `지역 목록을 불러오지 못했습니다. (${res.status})` });
      return;
    }
    const d = await res.json();
    setSigunguList(d.areas ?? []);
  }

  async function toggle(sigunguCode: string, isEnabled: boolean) {
    setMsg(null);
    const res = await fetch("/api/admin/service-areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sigunguCode, isEnabled }),
    });
    if (res.ok) { setMsg({ type: "ok", text: "저장했습니다." }); await load(); }
    else setMsg({ type: "err", text: "저장 실패" });
  }

  async function syncOfficialAreas() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/service-areas/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "공식 행정구역 동기화 실패");
      setMsg({
        type: "ok",
        text: `공식 행정구역 ${Number(data.areaCount ?? 0).toLocaleString("ko-KR")}건을 불러왔습니다.`,
      });
      await load();
    } catch (error) {
      setMsg({ type: "err", text: error instanceof Error ? error.message : "공식 행정구역 동기화 실패" });
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;

  const enabledCodes = new Set(rows.filter((r) => r.is_enabled === 1).map((r) => r.sigungu_code));
  const directDongMode = sigunguList.length > 0 && sigunguList[0]?.level === "eupmyeondong";
  const selectedSido = sidoList.find((item) => item.code === sido);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold">서비스 가능지역</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
          직접 예약을 받을 시/군/구를 지정합니다. 지정하지 않은 지역의 고객은
          예약 대신 상담 접수로 안내됩니다.
        </p>
      </div>

      {!imported && (
        <div className="rounded-xl bg-[#FBE9D3] p-4 text-sm leading-relaxed text-[var(--amber)]">
          <p className="font-semibold">공식 행정구역 데이터를 먼저 불러와주세요.</p>
          <p className="mt-1.5">
            행정표준코드관리시스템(code.go.kr)의 법정동 전체자료가 아직 등록되지 않았습니다.
            임포트 전에는 고객 예약폼의 지역 선택이 동작하지 않으며,
            서비스 지역 검증도 적용되지 않습니다.
          </p>
          <button
            type="button"
            onClick={() => void syncOfficialAreas()}
            disabled={syncing}
            className="mt-3 rounded-lg bg-[var(--navy)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {syncing ? "공식 행정구역 불러오는 중..." : "공식 행정구역 불러오기"}
          </button>
        </div>
      )}

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      {imported && (
        <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">지역 추가 / 변경</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                등록된 행정구역 {areaCount.toLocaleString("ko-KR")}건
              </p>
            </div>
            <button
              type="button"
              onClick={() => void syncOfficialAreas()}
              disabled={syncing}
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium disabled:opacity-50"
            >
              {syncing ? "동기화 중..." : "공식 데이터 새로고침"}
            </button>
          </div>
          <select
            value={sido}
            onChange={(e) => void pickSido(e.target.value)}
            className="mt-3 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm sm:w-64"
          >
            <option value="">시/도 선택</option>
            {sidoList.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>

          {directDongMode && sido && selectedSido && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void toggle(sido, !enabledCodes.has(sido))}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                  enabledCodes.has(sido)
                    ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]"
                    : "border-[var(--line)] text-[var(--ink-soft)]"
                }`}
              >
                <span className="font-medium">{selectedSido.name}</span>
                <span className="text-xs">{enabledCodes.has(sido) ? "예약 가능" : "상담 전환"}</span>
              </button>
            </div>
          )}

          {!directDongMode && sigunguList.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {sigunguList.map((g) => {
                const on = enabledCodes.has(g.code);
                return (
                  <button
                    key={g.code}
                    onClick={() => void toggle(g.code, !on)}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition ${
                      on
                        ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]"
                        : "border-[var(--line)] text-[var(--ink-soft)]"
                    }`}
                  >
                    <span className="font-medium">{g.name}</span>
                    <span className="text-xs">{on ? "예약 가능" : "상담 전환"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section>
        <p className="mb-3 text-sm font-semibold">
          예약 가능 지역 ({rows.filter((r) => r.is_enabled === 1).length})
        </p>
        {rows.filter((r) => r.is_enabled === 1).length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">
            지정된 지역이 없습니다. 지역을 지정하지 않으면 모든 고객이 상담으로 안내됩니다.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.filter((r) => r.is_enabled === 1).map((r) => (
              <div key={r.sigungu_code} className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{r.name ?? r.sigungu_code}</p>
                  <p className="text-xs text-[var(--ink-soft)]">{r.sigungu_code}</p>
                </div>
                <button
                  onClick={() => void toggle(r.sigungu_code, false)}
                  className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium"
                >
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
