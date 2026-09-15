import { revalidateTag } from "next/cache";
import { PUBLIC_PRICING_CACHE_TAG } from "@/lib/public-pricing-cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession } from "@/lib/session";
import {
  listPriceRules,
  upsertPriceRule,
  deletePriceRule,
  getOptionPrices,
  updateOptionPrice,
} from "@/lib/pricing";
import {
  SERVICE_TYPES,
  EXTRA_OPTIONS,
  HOUSE_TYPES_FIXED,
  HOUSE_SIZES_APARTMENT,
} from "@/lib/types";

const MAX_PRICE = 10_000_000;
const MAX_AREA = 1000;

const FIXED_HOUSE_KEYS = new Set<string>([
  ...HOUSE_TYPES_FIXED,
  ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
]);

const ruleSchema = z.object({
  id: z.number().int().optional(),
  serviceType: z
    .string()
    .refine((v) => (SERVICE_TYPES as readonly string[]).includes(v), {
      message: `청소 서비스 종류가 올바르지 않습니다. 허용값: ${SERVICE_TYPES.join(", ")}`,
    }),
  areaMin: z.number().min(0).max(MAX_AREA).finite(),
  areaMax: z.number().min(0).max(MAX_AREA).finite().nullable().optional(),
  basePrice: z.number().min(0).max(MAX_PRICE).finite(),
  // 평형별 예약 선금. 총 청소금액에 포함되는 금액이며 추가 비용이 아니다.
  depositAmount: z.number().min(0).max(MAX_PRICE).finite().optional(),
  isActive: z.boolean().optional().default(true),
  note: z.string().max(200).trim().optional().nullable(),
  /** 상품 키 — 서비스별 독립 가격 모델의 조회 기준 */
  productKey: z.string().max(50).trim().optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.areaMax != null && data.areaMax < data.areaMin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `최대 평수(${data.areaMax}평)는 최소 평수(${data.areaMin}평) 이상이어야 합니다.`,
      path: ["areaMax"],
    });
  }
});

const ALLOWED_OPTION_KEYS = EXTRA_OPTIONS.map((o) => o.key) as [string, ...string[]];

const optionSchema = z.object({
  optionKey: z.enum(ALLOWED_OPTION_KEYS, {
    message: `허용되지 않는 옵션 키입니다. 유효한 키: ${ALLOWED_OPTION_KEYS.join(", ")}`,
  }),
  price: z.number().min(0).max(MAX_PRICE).finite(),
  isActive: z.boolean().optional().default(true),
});

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  return NextResponse.json({
    rules: await listPriceRules(),
    options: await getOptionPrices(false),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  try {
    if (body.type === "rule") {
      const parsed = ruleSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." },
          { status: 400 }
        );
      }

      const { id: editId, serviceType, basePrice, depositAmount, isActive, note } = parsed.data;
      // 서비스별 독립 가격 모델 — product_key가 상품 식별자다.
      // 입주청소뿐 아니라 사이청소/거주청소/집정리도 각자 수정할 수 있다.
      const productKey = parsed.data.productKey ?? note ?? null;
      if (!productKey) {
        return NextResponse.json({ error: "상품 키가 필요합니다." }, { status: 400 });
      }

      const allRules = await listPriceRules();
      const existing = allRules.find(
        (r) => r.service_type === serviceType && (r.product_key ?? r.note) === productKey
      );
      if (!existing && !FIXED_HOUSE_KEYS.has(productKey)) {
        return NextResponse.json(
          { error: "등록된 상품만 수정할 수 있습니다." },
          { status: 400 }
        );
      }
      const targetId = editId ?? existing?.id;

      // 예약금은 총 청소금액을 넘을 수 없다 (예약금은 총액에 포함되는 금액).
      const nextDeposit =
        depositAmount != null ? Math.round(depositAmount) : Math.round(existing?.deposit_amount ?? 0);
      const nextBase = Math.round(basePrice);
      if (nextDeposit > nextBase && nextBase > 0) {
        return NextResponse.json(
          {
            error:
              `예약금(${nextDeposit.toLocaleString("ko-KR")}원)은 ` +
              `청소금액(${nextBase.toLocaleString("ko-KR")}원)보다 클 수 없습니다.`,
          },
          { status: 400 }
        );
      }

      await upsertPriceRule({
        id: targetId,
        service_type: serviceType,
        area_min: 0,
        area_max: null,
        base_price: nextBase,
        deposit_amount: nextDeposit,
        product_key: productKey,
        is_active: isActive !== false ? 1 : 0,
        note: note ?? productKey,
      });
    } else if (body.type === "option") {
      const parsed = optionSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." },
          { status: 400 }
        );
      }
      const { optionKey, price, isActive } = parsed.data;
      await updateOptionPrice(optionKey, Math.round(price), isActive !== false);
    } else {
      return NextResponse.json(
        { error: "type이 'rule' 또는 'option'이어야 합니다." },
        { status: 400 }
      );
    }

    revalidateTag(PUBLIC_PRICING_CACHE_TAG, { expire: 0 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[price-rules]", e);
    return NextResponse.json(
      { error: "저장 중 오류가 발생했습니다. 입력값을 다시 확인해주세요." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: "삭제할 규칙 ID가 필요합니다." }, { status: 400 });
  }

  try {
    await deletePriceRule(id);
    revalidateTag(PUBLIC_PRICING_CACHE_TAG, { expire: 0 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[price-rules DELETE]", e);
    return NextResponse.json({ error: "삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
