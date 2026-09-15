"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 행정구역 계층 선택.
 *
 * - 시/도 → 시/군/구 → 읍/면/동 순으로 필요한 단계만 지연 조회한다.
 * - 행정구역 계층은 module cache + HTTP cache를 사용해 반복 조회를 피한다.
 * - 서비스 가능 여부는 시/군/구를 선택하는 순간 별도 no-store 요청으로 확인한다.
 * - 세종특별자치시처럼 시/군/구 단계가 없는 지역은 시/도 자체를 서비스지역 key로 사용한다.
 */
export interface RegionValue {
  sidoCode: string;
  sidoName: string;
  sigunguCode: string;
  sigunguName: string;
  dongCode: string;
  dongName: string;
  serviceAvailable: boolean | null;
}

export const EMPTY_REGION: RegionValue = {
  sidoCode: "", sidoName: "",
  sigunguCode: "", sigunguName: "",
  dongCode: "", dongName: "",
  serviceAvailable: null,
};

interface AreaOption {
  code: string;
  name: string;
  level: "sido" | "sigungu" | "eupmyeondong";
  serviceAvailable: boolean | null;
}

interface CachedAreas {
  areas: AreaOption[];
  imported: boolean;
}

const areaCache = new Map<string, CachedAreas>();

export default function RegionSelect({
  value,
  onChange,
  onImportedChange,
}: {
  value: RegionValue;
  onChange: (next: RegionValue) => void;
  onImportedChange?: (imported: boolean) => void;
}) {
  const [sidoList, setSidoList] = useState<AreaOption[]>([]);
  const [midList, setMidList] = useState<AreaOption[]>([]);
  const [dongList, setDongList] = useState<AreaOption[]>([]);
  const [imported, setImported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAreas = useCallback(async (parent?: string): Promise<AreaOption[]> => {
    const key = parent ?? "__sido__";
    const cached = areaCache.get(key);
    if (cached) {
      setImported(cached.imported);
      onImportedChange?.(cached.imported);
      return cached.areas;
    }

    const url = parent ? `/api/regions?parent=${encodeURIComponent(parent)}` : "/api/regions";
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error("regions fetch failed");
    const data = (await res.json()) as { areas?: AreaOption[]; imported?: boolean };
    const nextImported = data.imported !== false;
    const nextAreas = data.areas ?? [];
    areaCache.set(key, { areas: nextAreas, imported: nextImported });
    setImported(nextImported);
    onImportedChange?.(nextImported);
    return nextAreas;
  }, [onImportedChange]);

  const fetchServiceAvailability = useCallback(async (code: string): Promise<boolean> => {
    const res = await fetch(`/api/regions?availability=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) throw new Error("service area fetch failed");
    const data = (await res.json()) as { serviceAvailable?: boolean };
    return data.serviceAvailable === true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const list = await fetchAreas();
        if (!cancelled) setSidoList(list);
      } catch {
        if (!cancelled) {
          setImported(false);
          onImportedChange?.(false);
        }
      }
    });
    return () => { cancelled = true; };
  }, [fetchAreas, onImportedChange]);

  async function pickSido(code: string) {
    const selectedSido = sidoList.find((s) => s.code === code);
    onChange({ ...EMPTY_REGION, sidoCode: code, sidoName: selectedSido?.name ?? "" });
    setMidList([]);
    setDongList([]);
    if (!code) return;

    setLoading(true);
    try {
      setMidList(await fetchAreas(code));
    } finally {
      setLoading(false);
    }
  }

  async function pickMid(code: string) {
    const mid = midList.find((m) => m.code === code);
    if (!mid) return;

    setLoading(true);
    try {
      if (mid.level === "eupmyeondong") {
        const serviceAvailable = await fetchServiceAvailability(value.sidoCode);
        onChange({
          ...value,
          sigunguCode: value.sidoCode,
          sigunguName: value.sidoName,
          dongCode: mid.code,
          dongName: mid.name,
          serviceAvailable,
        });
        return;
      }

      const [children, serviceAvailable] = await Promise.all([
        fetchAreas(code),
        fetchServiceAvailability(code),
      ]);
      onChange({
        ...value,
        sigunguCode: code,
        sigunguName: mid.name,
        dongCode: "",
        dongName: "",
        serviceAvailable,
      });
      setDongList(children);
    } finally {
      setLoading(false);
    }
  }

  function pickDong(code: string) {
    const dong = dongList.find((d) => d.code === code);
    onChange({ ...value, dongCode: code, dongName: dong?.name ?? "" });
  }

  const midIsDong = midList.length > 0 && midList[0].level === "eupmyeondong";
  const selectedMidCode = midIsDong ? value.dongCode : value.sigunguCode;

  if (imported === false) {
    return (
      <div>
        <label className="mb-1.5 block text-sm font-semibold">
          작업 장소 <span className="text-xs text-[var(--rose)]">*필수</span>
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          <select disabled className="min-h-[44px] w-full rounded-lg border border-[var(--line)] bg-[var(--sand-deep)] px-3 text-sm text-[var(--ink-soft)]"><option>시/도 선택</option></select>
          <select disabled className="min-h-[44px] w-full rounded-lg border border-[var(--line)] bg-[var(--sand-deep)] px-3 text-sm text-[var(--ink-soft)]"><option>시/군/구 선택</option></select>
          <select disabled className="min-h-[44px] w-full rounded-lg border border-[var(--line)] bg-[var(--sand-deep)] px-3 text-sm text-[var(--ink-soft)]"><option>읍/면/동 선택</option></select>
        </div>
        <p className="mt-1.5 text-xs text-[var(--amber)]">공식 행정구역 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold">
        작업 장소 <span className="text-xs text-[var(--rose)]">*필수</span>
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          value={value.sidoCode}
          onChange={(e) => void pickSido(e.target.value)}
          disabled={imported !== true}
          className="min-h-[44px] w-full rounded-lg border border-[var(--line)] px-3 text-sm focus:border-[var(--mint)] focus:outline-none"
        >
          <option value="">시/도 선택</option>
          {sidoList.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>

        <select
          value={selectedMidCode}
          onChange={(e) => void pickMid(e.target.value)}
          disabled={midList.length === 0}
          className="min-h-[44px] w-full rounded-lg border border-[var(--line)] px-3 text-sm focus:border-[var(--mint)] focus:outline-none disabled:bg-[var(--sand-deep)] disabled:text-[var(--ink-soft)]"
        >
          <option value="">{midIsDong ? "읍/면/동 선택" : "시/군/구 선택"}</option>
          {midList.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>

        <select
          value={value.dongCode}
          onChange={(e) => pickDong(e.target.value)}
          disabled={midIsDong || dongList.length === 0}
          className="min-h-[44px] w-full rounded-lg border border-[var(--line)] px-3 text-sm focus:border-[var(--mint)] focus:outline-none disabled:bg-[var(--sand-deep)] disabled:text-[var(--ink-soft)]"
        >
          <option value="">{midIsDong ? "해당 없음" : "읍/면/동 선택"}</option>
          {dongList.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </div>

      {loading && <p className="mt-1.5 text-xs text-[var(--ink-soft)]">지역 목록을 불러오는 중...</p>}

      {value.serviceAvailable === false && (
        <div className="mt-2 rounded-lg bg-[#FBE9D3] px-3 py-2.5 text-xs leading-relaxed text-[var(--amber)]">
          선택하신 지역은 현재 직접 예약이 어렵습니다. 상담 접수를 남겨주시면 담당자가 확인 후 안내드립니다.
        </div>
      )}

      <p className="mt-1.5 text-xs text-[var(--ink-soft)]">상세 주소는 예약 확정 후 담당자가 별도로 확인합니다.</p>
    </div>
  );
}
