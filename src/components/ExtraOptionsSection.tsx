import { SectionHeading } from "./ServiceList";
import { getOptionPrices } from "@/lib/pricing";

const EXTRA_DESCRIPTIONS: Record<string, string> = {
  appliance_inside: "냉장고·세탁기·식기세척기 등 가전 내부 청소가 필요한 경우 확인합니다. 제품별 금액은 상담 후 안내드립니다.",
  extra_furniture: "도면에 포함된 기본 가구 외 추가 가구가 있는 경우 확인합니다.",
  hidden_closet: "도면에 표시되지 않은 붙박이장이 있는 경우 추가 확인이 필요합니다.",
  hidden_storage: "도면에 없는 추가 수납공간이 있는 경우 확인합니다.",
  extra_pantry: "기본 범위 외 팬트리 공간이 별도로 있는 경우 확인합니다.",
  heavy_mold: "장기간 고착된 곰팡이, 실리콘 내부 곰팡이, 광범위 곰팡이가 있는 경우 확인합니다. 일반 표면 오염은 기본 범위에 포함됩니다.",
  heavy_stain: "장기간 방치되어 일반 청소로 처리하기 어려운 심한 오염이 있는 경우 확인합니다.",
  outer_window: "외창(건물 외부) 또는 고소작업이 필요한 특수 위치 유리 청소가 필요한 경우 확인합니다.",
  pet_extra: "반려동물 털·냄새·배변 오염이 있는 경우 추가 청소 항목을 확인합니다. 상태 확인 후 사전에 안내드립니다.",
  hood_filter: "주방 후드 철망 또는 필터 교체가 필요한 경우 확인합니다. 제품 확인 후 비용을 안내드립니다.",
  drain_trap: "배수구 트랩을 새제품으로 교체하는 경우 확인합니다. 제품 확인 후 비용을 안내드립니다.",
  parts_replace: "위 항목 외 소모성 부품(샤워헤드 필터 등) 교체가 필요한 경우 확인합니다.",
  minor_repair: "간단한 집수리(나사 조임, 경첩 교체 등)가 필요한 경우 확인합니다. 작업 범위 확인 후 안내드립니다.",
  silicone_repair: "부분적인 실리콘 보수 또는 재시공이 필요한 경우 확인합니다. 범위 확인 후 안내드립니다.",
};

export default async function ExtraOptionsSection() {
  const availableOptions = await getOptionPrices();

  if (availableOptions.length === 0) return null;

  return (
    <section className="bg-[var(--sand)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="추가 서비스 안내"
          title="현장에 따라 추가로 확인하는 항목"
          desc="현장 상태나 고객 요청에 따라 추가 확인이 필요한 항목입니다. 별도 상담 항목은 작업 전 금액을 안내하고 고객 동의 후 진행합니다."
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {availableOptions.map((opt) => (
            <div key={opt.option_key} className="rounded-2xl border border-[var(--line)] bg-white p-6">
              <p className="font-display text-base font-bold">{opt.option_label}</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                {EXTRA_DESCRIPTIONS[opt.option_key] || ""}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
