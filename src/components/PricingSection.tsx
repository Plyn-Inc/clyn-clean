import { listPriceRules } from "@/lib/pricing";
import {
  HOUSE_TYPES_FIXED,
  HOUSE_SIZES_APARTMENT,
  HOUSE_TYPE_STRUCTURE,
  VAT_NOTICE,
} from "@/lib/types";
import { SectionHeading } from "./ServiceList";

/**
 * 홈페이지 가격표 섹션.
 *
 * - price_rules를 single source of truth로 사용한다 (가격 하드코딩 없음)
 * - VAT를 자동 합산하지 않는다. 섹션 하단에 공통 안내 문구만 1회 표시한다.
 * - 카드마다 "VAT 별도"를 반복 표기하지 않는다.
 */
export default async function PricingSection() {
  const rules = await listPriceRules();
  const byNote = new Map(
    rules
      .filter((r) => r.service_type === "입주청소" && r.is_active === 1)
      .map((r) => [r.note ?? "", r])
  );

  const orderedKeys: string[] = [
    ...HOUSE_TYPES_FIXED,
    ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
  ];

  const items = orderedKeys
    .map((key) => {
      const rule = byNote.get(key);
      if (!rule || rule.base_price <= 0) return null;
      return {
        key,
        label: key === "40평" ? "40평 이상" : key,
        basePrice: rule.base_price,
        structure: HOUSE_TYPE_STRUCTURE[key] ?? "",
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  if (items.length === 0) return null;

  return (
    <section id="pricing" className="scroll-mt-24 bg-white py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="가격 안내"
          title="입주청소 기본 청소금액"
          desc="공급면적과 표준 주거 구조를 기준으로 한 기본 청소금액입니다. 현장 구조·오염도에 따라 추가 작업이 필요한 경우 작업 전에 안내드립니다."
        />

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-2xl border border-[var(--line)] bg-white p-6 transition hover:border-[var(--mint)]"
            >
              <p className="font-display text-base font-bold text-[var(--ink)]">{item.label}</p>
              {item.structure && (
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-soft)]">{item.structure}</p>
              )}
              <p className="mt-4 font-display text-2xl font-bold text-[var(--navy)]">
                {item.basePrice.toLocaleString("ko-KR")}
                <span className="ml-0.5 text-base font-semibold">원</span>
              </p>
            </div>
          ))}
        </div>

        {/* 가격 섹션 공통 VAT 안내 — 카드마다 반복 표기하지 않는다 */}
        <p className="mt-6 text-right text-sm font-medium text-[var(--ink-soft)]">{VAT_NOTICE}</p>

        <div className="mt-8 rounded-2xl bg-[var(--sand-deep)] p-6">
          <p className="text-sm font-semibold text-[var(--ink)]">추가 작업은 언제 발생하나요?</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            기본 개수를 초과하는 욕실, 비확장 베란다, 설계도면 외 팬트리·붙박이장, 추가 창호,
            심한 곰팡이·기름때 등 특수 오염이 확인되는 경우입니다. 현장에서 확인되면
            <strong className="text-[var(--ink)]"> 작업 전에 내용과 금액을 안내드리고 동의를 받은 후</strong>{" "}
            진행합니다.
          </p>
        </div>
      </div>
    </section>
  );
}
