"use client";

import {
  CORE_PRINCIPLES,
  AGREEMENT_SECTIONS,
  AGREEMENT_CHECK_LABELS,
  AGREEMENT_TITLE,
  AGREEMENT_VERSION,
} from "@/lib/agreement";

/**
 * 서비스 3종 필수 동의 UI.
 *
 * 요구사항:
 *  - 팝업/새 페이지 금지. 예약 마지막 단계 안에 직접 표시한다.
 *  - 1~11번 전체는 고정 높이 내부 스크롤 박스에 넣는다.
 *  - 끝까지 스크롤해야 체크할 수 있도록 강제하지 않는다.
 *  - 동의서 원문은 src/lib/agreement.ts 한 곳에서만 관리한다 (복사 금지).
 */
export interface AgreementState {
  corePrinciplesAgreed: boolean;
  serviceTermsAgreed: boolean;
  additionalChargeAgreed: boolean;
}

export default function AgreementSection({
  value,
  onChange,
}: {
  value: AgreementState;
  onChange: (next: AgreementState) => void;
}) {
  const set = (key: keyof AgreementState, checked: boolean) =>
    onChange({ ...value, [key]: checked });

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">{AGREEMENT_TITLE}</p>
        <span className="text-xs text-[var(--ink-soft)]">v{AGREEMENT_VERSION}</span>
      </div>

      {/* 체크 1 — 안내 핵심 원칙 (체크박스가 내용 위) */}
      <div className="rounded-2xl border border-[var(--line)] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={value.corePrinciplesAgreed}
            onChange={(e) => set("corePrinciplesAgreed", e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--line)]"
          />
          <span className="text-sm font-medium">
            <span className="text-[var(--rose)]">[필수]</span>{" "}
            {AGREEMENT_CHECK_LABELS.corePrinciples}
          </span>
        </label>
        <ul className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3">
          {CORE_PRINCIPLES.map((p) => (
            <li key={p} className="flex gap-2 text-xs leading-relaxed text-[var(--ink-soft)]">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--mint)]" />
              {p}
            </li>
          ))}
        </ul>
      </div>

      {/* 체크 2 — 1~11번 전체 (스크롤 박스 위에 체크박스) */}
      <div className="rounded-2xl border border-[var(--line)] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={value.serviceTermsAgreed}
            onChange={(e) => set("serviceTermsAgreed", e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--line)]"
          />
          <span className="text-sm font-medium">
            <span className="text-[var(--rose)]">[필수]</span>{" "}
            {AGREEMENT_CHECK_LABELS.serviceTerms}
          </span>
        </label>

        {/* 고정 높이 내부 스크롤 박스 — 페이지 스크롤과 분리 (overscroll-contain) */}
        <div
          className="mt-3 h-64 overflow-y-auto overscroll-contain rounded-xl bg-[var(--sand-deep)] p-4 text-xs leading-relaxed text-[var(--ink-soft)]"
          tabIndex={0}
          aria-label="청소 서비스 이용 및 현장 추가사항 안내 전체 내용"
        >
          {AGREEMENT_SECTIONS.map((sec) => (
            <div key={sec.no} className="mb-4 last:mb-0">
              <p className="mb-1.5 font-semibold text-[var(--ink)]">
                {sec.no}. {sec.title}
              </p>
              {sec.body.split("\n").map((line, i) => (
                <p key={i} className="mb-1 whitespace-pre-wrap last:mb-0">
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--ink-soft)]">
          위 박스 안에서 스크롤하여 전체 내용을 확인하실 수 있습니다.
        </p>
      </div>

      {/* 체크 3 — 견적/추가요금 인지 (독립 체크박스) */}
      <div className="rounded-2xl border border-[var(--line)] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={value.additionalChargeAgreed}
            onChange={(e) => set("additionalChargeAgreed", e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--line)]"
          />
          <span className="text-sm leading-relaxed">
            <span className="font-medium text-[var(--rose)]">[필수]</span>{" "}
            {AGREEMENT_CHECK_LABELS.additionalCharge}
          </span>
        </label>
      </div>
    </div>
  );
}
