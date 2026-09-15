"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 행정구역 계층 선택.
 *
 * - 시/도 → 시/군/구 → 읍/면/동 순으로 서버에서 목록을 받아 선택한다.
 * - 세종특별자치시처럼 시/군/구 단계가 없는 지역은 서버가 sido의 자식으로
 *   바로 읍/면/동(level="eupmyeondong")을 내려준다. 이 컴포넌트는 level 값으로
 *   판단하므로 지역 구조가 달라도 동작한다.
 * - 시/군/구 선택 시 서비스 가능 여부를 즉시 안내한다.
 * - 행정구역 master가 아직 임포트되지 않은 환경에서는 안내 문구를 노출한다.
 */
export interface RegionValue {
  sidoCode: string;
  sidoName: string;
  sigunguCode: string;
  sigunguName: string;
  dongCode: string;
  dongName: string;
  /** 선택한 시/군/구가 서비스 가능 지역인지 (null = 판단 불가) */
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

export default function RegionSelect({
  value,
  onChange,
}: {
  value: RegionValue;
  onChange: (next: RegionValue) => void;
}) {
  const [sidoList, setSidoList] = useState<AreaOption[]>([]);
  const [midList, setMidList] = useState<AreaOption[]>([]);
  const [dongList, setDongList] = useState<AreaOption[]>([]);
  const [imported, setImported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAreas = useCallback(async (parent?: string): Promise<AreaOption[]> => {
    const url = parent ? `/api/regions?parent=${encodeURIComponent(parent)}` : "/api/regions";
    const res = await fetch(url);
    if (!res.ok) throw new Error("regions fetch failed");
    const data = (await res.json()) as { areas?: AreaOption[]; imported?: boolean };
    if (data.imported === false) setImported(false);
    else setImported(true);
    return data.areas ?? [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    // effect 내 동기 setState 경고를 피하기 위해 microtask로 넘긴다
    void Promise.resolve().then(async () => {
      try {
        const list = await fetchAreas();
        if (!cancelled) setSidoList(list);
      } catch {
        if (!cancelled) setImported(false);
      }
    });
    return () => { cancelled = true; };
  }, [fetchAreas]);

  async function pickSido(code: string) {
    const sido = sidoList.find((s) => s.code === code);
    onChange({ ...EMPTY_REGION, sidoCode: code, sidoName: sido?.name ?? "" });
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

    // 세종시 등: sido의 자식이 바로 읍면동인 경우 — 시/군/구 없이 확정된다
    if (mid.level === "eupmyeondong") {
      onChange({
        ...value,
        sigunguCode: "", sigunguName: "",
        dongCode: mid.code, dongName: mid.name,
        serviceAvailable: null,
      });
      return;
    }

    onChange({
      ...value,
      sigunguCode: code,
      sigunguName: mid.name,
      dongCode: "", dongName: "",
      serviceAvailable: mid.serviceAvailable,
    });
    setDongList([]);
    setLoading(true);
    try {
      setDongList(await fetchAreas(code));
    } finally {
      setLoading(false);
    }
  }

  function pickDong(code: string) {
    const dong = dongList.find((d) => d.code === code);
    onChange({ ...value, dongCode: code, dongName: dong?.name ?? "" });
  }

  // 시/도의 자식이 읍면동인지(시군구 단계 없음) 판단
  const midIsDong = midList.length > 0 && midList[0].level === "eupmyeondong";
  const selectedMidCode = midIsDong ? value.dongCode : value.sigunguCode;

  if (imported === false) {
    return (
      <div className="rounded-xl bg-[#FBE9D3] p-4 text-sm leading-relaxed text-[var(--amber)]">
        <p className="font-semibold">지역 선택을 준비 중입니다.</p>
        <p className="mt-1">
          잠시 후 다시 시도하시거나, 상담 접수를 남겨주시면 담당자가 확인 후 연락드립니다.
        </p>
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
          className="min-h-[44px] w-full rounded-lg border border-[var(--line)] px-3 text-sm focus:border-[var(--mint)] focus:outline-none"
        >
          <option value="">시/도 선택</option>
          {sidoList.map((s) => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>

        <select
          value={selectedMidCode}
          onChange={(e) => void pickMid(e.target.value)}
          disabled={midList.length === 0}
          className="min-h-[44px] w-full rounded-lg border border-[var(--line)] px-3 text-sm focus:border-[var(--mint)] focus:outline-none disabled:bg-[var(--sand-deep)] disabled:text-[var(--ink-soft)]"
        >
          <option value="">{midIsDong ? "읍/면/동 선택" : "시/군/구 선택"}</option>
          {midList.map((m) => (
            <option key={m.code} value={m.code}>{m.name}</option>
          ))}
        </select>

        <select
          value={value.dongCode}
          onChange={(e) => pickDong(e.target.value)}
          disabled={midIsDong || dongList.length === 0}
          className="min-h-[44px] w-full rounded-lg border border-[var(--line)] px-3 text-sm focus:border-[var(--mint)] focus:outline-none disabled:bg-[var(--sand-deep)] disabled:text-[var(--ink-soft)]"
        >
          <option value="">{midIsDong ? "해당 없음" : "읍/면/동 선택"}</option>
          {dongList.map((d) => (
            <option key={d.code} value={d.code}>{d.name}</option>
          ))}
        </select>
      </div>

      {loading && <p className="mt-1.5 text-xs text-[var(--ink-soft)]">지역 목록을 불러오는 중...</p>}

      {value.serviceAvailable === false && (
        <div className="mt-2 rounded-lg bg-[#FBE9D3] px-3 py-2.5 text-xs leading-relaxed text-[var(--amber)]">
          선택하신 지역은 현재 직접 예약이 어렵습니다. 상담 접수를 남겨주시면 담당자가 확인 후 안내드립니다.
        </div>
      )}

      <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
        상세 주소는 예약 확정 후 담당자가 별도로 확인합니다.
      </p>
    </div>
  );
}
