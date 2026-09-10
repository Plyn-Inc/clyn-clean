import { NextResponse } from "next/server";
import { listPriceRules } from "@/lib/pricing";
import {
  HOUSE_TYPES_FIXED,
  HOUSE_SIZES_APARTMENT,
  HOUSE_TYPE_STRUCTURE,
  VAT_NOTICE,
} from "@/lib/types";

/**
 * 홈페이지 공개 가격표 API.
 *
 * price_rules를 single source of truth로 사용한다 (가격 하드코딩 금지).
 * VAT는 자동 합산하지 않고, 공통 안내 문구만 함께 내려보낸다.
 */
export async function GET() {
  const rules = await listPriceRules();
  const byNote = new Map(
    rules
      .filter((r) => r.service_type === "입주청소" && r.is_active === 1)
      .map((r) => [r.note ?? "", r])
  );

  // 표시 순서: 고정 주택형 → 아파트 평형
  const orderedKeys: string[] = [
    ...HOUSE_TYPES_FIXED,
    ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
  ];

  const items = orderedKeys
    .map((key) => {
      const rule = byNote.get(key);
      if (!rule || rule.base_price <= 0) return null;
      return {
        houseTypeKey: key,
        // 40평은 "40평 이상"으로 표시한다
        label: key === "40평" ? "40평 이상" : key,
        basePrice: rule.base_price,
        structure: HOUSE_TYPE_STRUCTURE[key] ?? "",
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return NextResponse.json({ items, vatNotice: VAT_NOTICE });
}
