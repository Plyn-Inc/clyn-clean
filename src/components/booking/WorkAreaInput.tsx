"use client";

/**
 * 작업지역 입력 — 행정구역 동 기준까지만 받는다.
 * 상세 주소는 이후 예약정보 단계에서 별도로 받는다.
 */
export interface WorkAreaValue {
  sido: string;
  sigungu: string;
  dong: string;
}

const SIDO_OPTIONS = [
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시",
  "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도",
  "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도",
  "경상남도", "제주특별자치도",
];

export default function WorkAreaInput({
  value,
  onChange,
}: {
  value: WorkAreaValue;
  onChange: (next: WorkAreaValue) => void;
}) {
  const set = (key: keyof WorkAreaValue, v: string) => onChange({ ...value, [key]: v });

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold">
        작업 장소 <span className="text-xs text-[var(--rose)]">*필수</span>
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          value={value.sido}
          onChange={(e) => set("sido", e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
        >
          <option value="">시/도 선택</option>
          {SIDO_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          value={value.sigungu}
          onChange={(e) => set("sigungu", e.target.value)}
          placeholder="시/군/구"
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
        />
        <input
          value={value.dong}
          onChange={(e) => set("dong", e.target.value)}
          placeholder="행정동 (예: 역삼동)"
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
        />
      </div>
      <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
        상세 주소는 예약 확정 후 담당자가 별도로 확인합니다.
      </p>
    </div>
  );
}
