import { NextResponse } from "next/server";
import { listPriceRules } from "@/lib/pricing";
import { VAT_NOTICE } from "@/lib/types";

/**
 * 고객 예약폼에서 한 번만 받아 캐시하는 공개 가격표.
 * 서비스별 독립 price_rules row를 그대로 사용하며 비활성 상품은 노출하지 않는다.
 */
export async function GET() {
  const rules = await listPriceRules();
  const items = rules
    .filter((r) => r.is_active === 1 && (r.product_key ?? r.note) && r.base_price > 0)
    .map((r) => {
      const productKey = r.product_key ?? r.note ?? "";
      return {
        serviceType: r.service_type,
        productKey,
        // 기존 공개 응답과의 호환을 위해 유지
        houseTypeKey: productKey,
        label: productKey === "40평" ? "40평 이상" : productKey,
        basePrice: Number(r.base_price),
        depositAmount: Number(r.deposit_amount ?? 0),
      };
    });

  return NextResponse.json({ items, vatNotice: VAT_NOTICE });
}
