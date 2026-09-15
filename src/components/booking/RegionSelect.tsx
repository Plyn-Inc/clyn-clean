"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 행정구역 계층 선택.
 *
 * - 시/도 → 시/군/구 → 읍/면/동 순으로 필요한 단계만 지연 조회한다.
 * - 공개 API는 예약 가능지역만 반환하며, module cache로 같은 화면 안의 반복 조회를 피한다.
 * - 고객 API 자체가 예약 가능지역만 반환하므로 노출된 지역은 모두 직접예약 가능하다.
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
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("regions fetch failed");
    const data = (await res.json()) as { areas?: AreaOption[]; imported?: boolean };
    const nextImported = data.imported !== false;
    const nextAreas = data.areas ?? [];
    areaCache.set(key, { areas: nextAreas, imported: nextImported });
    setImported(nextImported);
    onImportedChange?.(nextImported);
    return nextAreas;
  }, [onImportedChange]);

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
        onChange({
          ...value,
          sigunguCode: value.sidoCode,
          sigunguName: value.sidoName,
          dongCode: mid.code,
          dongName: mid.name,
          serviceAvailable: true,
        });
        return;
      }

      const children = await fetchAreas(code);
      onChange({
        ...value,
        sigunguCode: code,
        sigunguName: mid.name,
        dongCode: "",
        dongName: "",
        serviceAvailable: true,
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


      <p className="mt-1.5 text-xs text-[var(--ink-soft)]">상세 주소는 예약 확정 후 담당자가 별도로 확인합니다.</p>
    </div>
  );
}
