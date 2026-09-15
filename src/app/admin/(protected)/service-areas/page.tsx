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

/** 시/군/구 체크박스로 직접예약 가능지역을 관리한다. */
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
      const regionRes = await fetch("/api/admin/regions", { cache: "no-store" });
      if (!regionRes.ok) throw new Error(`행정구역 목록 조회 실패 (${regionRes.status})`);
      const regionData = await regionRes.json();
      setSidoList(regionData.areas ?? []);
      setImported(regionData.imported === true);

      if (regionData.imported === true) {
        const adminRes = await fetch("/api/admin/service-areas", { cache: "no-store" });
        if (!adminRes.ok) throw new Error(`서비스 지역 설정 조회 실패 (${adminRes.status})`);
        const adminData = await adminRes.json();
        setRows(adminData.serviceAreas ?? []);
        setAreaCount(adminData.areaCount ?? 0);
      } else {
        setRows([]);
        setAreaCount(0);
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

  useEffect(() => { void load(); }, []);

  async function pickSido(code: string) {
    setSido(code);
    setSigunguList([]);
    if (!code) return;
    const res = await fetch(`/api/admin/regions?parent=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) {
      setMsg({ type: "err", text: `지역 목록을 불러오지 못했습니다. (${res.status})` });
      return;
    }
    const data = await res.json();
    setSigunguList(data.areas ?? []);
  }

  async function toggle(sigunguCode: string, isEnabled: boolean) {
    setMsg(null);
    const res = await fetch("/api/admin/service-areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sigunguCode, isEnabled }),
    });
    if (!res.ok) {
      setMsg({ type: "err", text: "저장 실패" });
      return;
    }

    const name = sigunguList.find((item) => item.code === sigunguCode)?.name
      ?? sidoList.find((item) => item.code === sigunguCode)?.name
      ?? null;
    setRows((prev) => {
      const existing = prev.find((row) => row.sigungu_code === sigunguCode);
      if (existing) {
        return prev.map((row) => row.sigungu_code === sigunguCode ? { ...row, is_enabled: isEnabled ? 1 : 0 } : row);
      }
      return [...prev, { sigungu_code: sigunguCode, name, is_enabled: isEnabled ? 1 : 0, admin_note: null }];
    });
    setMsg({ type: "ok", text: "저장했습니다." });
  }

  async function syncOfficialAreas() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/service-areas/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "공식 행정구역 동기화 실패");
      setMsg({ type: "ok", text: `공식 행정구역 ${Number(data.areaCount ?? 0).toLocaleString("ko-KR")}건을 불러왔습니다.` });
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
          시/도를 선택한 뒤 직접 예약을 받을 시/군/구만 체크합니다. 체크한 지역만 고객 예약 화면에 노출됩니다.
        </p>
      </div>

      {!imported && (
        <div className="rounded-xl bg-[#FBE9D3] p-4 text-sm leading-relaxed text-[var(--amber)]">
          <p className="font-semibold">공식 행정구역 데이터를 먼저 불러와주세요.</p>
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
              <p className="text-sm font-semibold">예약 가능지역 체크</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">등록된 행정구역 {areaCount.toLocaleString("ko-KR")}건</p>
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
            {sidoList.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>

          {directDongMode && sido && selectedSido && (
            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={enabledCodes.has(sido)}
                onChange={(e) => void toggle(sido, e.target.checked)}
                className="h-5 w-5 accent-[var(--navy)]"
              />
              <span className="font-medium">{selectedSido.name}</span>
            </label>
          )}

          {!directDongMode && sigunguList.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {sigunguList.map((g) => (
                <label key={g.code} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] px-4 py-3 text-sm hover:bg-[var(--sand-deep)]">
                  <input
                    type="checkbox"
                    checked={enabledCodes.has(g.code)}
                    onChange={(e) => void toggle(g.code, e.target.checked)}
                    className="h-5 w-5 accent-[var(--navy)]"
                  />
                  <span className="font-medium">{g.name}</span>
                </label>
              ))}
            </div>
          )}

          {sido && sigunguList.length === 0 && (
            <p className="mt-4 text-sm text-[var(--ink-soft)]">해당 시/도의 하위 행정구역을 불러오는 중이거나 등록된 목록이 없습니다.</p>
          )}
        </section>
      )}
    </div>
  );
}
