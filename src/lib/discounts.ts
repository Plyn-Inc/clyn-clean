/**
 * 통합 할인 계산.
 *
 * 계산 순서 (확정):
 *   정상가 → 자동 프로모션 → 쿠폰 → 관리자 수동 할인 → 최종금액
 *
 * 원칙:
 *   - 자동 프로모션과 쿠폰은 중복 적용된다
 *   - 자동 프로모션이 여러 개 조건을 만족하면 **가장 큰 할인 1개**만 적용한다
 *   - 정률 할인은 "그 단계 진입 시점의 현재 금액"을 기준으로 계산한다
 *   - finalAmount >= 0을 보장한다
 *   - quote 발급은 쿠폰 사용횟수를 소진하지 않는다 (예약 저장 transaction에서 처리)
 */
import { queryRow, queryRows } from "@/database/connection";

export type DiscountType = "fixed" | "percent";

export interface PromotionRow {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
  discount_type: DiscountType;
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  service_type: string | null;
  product_key: string | null;
  min_amount: number;
  max_discount_amount: number | null;
  priority: number;
}

export interface CouponRow extends Omit<PromotionRow, "priority"> {
  code: string;
  total_usage_limit: number | null;
  per_phone_limit: number | null;
}

export class CouponError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "CouponError";
    this.code = code;
  }
}

/** 쿠폰 코드 정규화 — trim + 대문자 */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * 할인액을 계산한다.
 *
 * 정률은 baseAmount(해당 단계 진입 시점 금액)를 기준으로 하며,
 * max_discount_amount가 있으면 그 값으로 상한을 둔다.
 * 남은 금액을 초과하지 않는다 (finalAmount >= 0 보장).
 */
export function computeDiscountAmount(
  rule: { discount_type: DiscountType; discount_value: number; max_discount_amount: number | null },
  baseAmount: number
): number {
  if (baseAmount <= 0) return 0;
  let amount =
    rule.discount_type === "percent"
      ? Math.floor((baseAmount * rule.discount_value) / 100)
      : rule.discount_value;

  if (rule.max_discount_amount != null && rule.max_discount_amount >= 0) {
    amount = Math.min(amount, rule.max_discount_amount);
  }
  return Math.max(0, Math.min(amount, baseAmount));
}

/** 기간·활성·상품 조건을 만족하는지 */
function matchesConditions(
  rule: Pick<PromotionRow, "is_active" | "starts_at" | "ends_at" | "service_type" | "product_key" | "min_amount">,
  ctx: { serviceType: string; productKey: string | null; amount: number; now: Date }
): boolean {
  if (rule.is_active !== 1) return false;

  const nowIso = ctx.now.toISOString();
  if (rule.starts_at && nowIso < rule.starts_at) return false;
  if (rule.ends_at && nowIso > rule.ends_at) return false;

  if (rule.service_type && rule.service_type !== ctx.serviceType) return false;
  if (rule.product_key && rule.product_key !== ctx.productKey) return false;
  if (ctx.amount < (rule.min_amount ?? 0)) return false;

  return true;
}

export interface AppliedPromotion {
  promotionId: number;
  promotionName: string;
  amount: number;
}

/**
 * 조건을 만족하는 자동 프로모션 중 **가장 큰 할인 1개**를 고른다.
 * 동일 할인액이면 priority가 높은 것, 그 다음 id가 작은 것을 택한다(결정적).
 */
export async function pickBestPromotion(ctx: {
  serviceType: string;
  productKey: string | null;
  amount: number;
  now?: Date;
}): Promise<AppliedPromotion | null> {
  const now = ctx.now ?? new Date();
  const rows = await queryRows<PromotionRow>(
    "SELECT * FROM discount_promotions WHERE is_active = 1 ORDER BY priority DESC, id ASC"
  );

  let best: AppliedPromotion | null = null;
  for (const r of rows) {
    if (!matchesConditions(r, { ...ctx, now })) continue;
    const amount = computeDiscountAmount(r, ctx.amount);
    if (amount <= 0) continue;
    if (!best || amount > best.amount) {
      best = { promotionId: r.id, promotionName: r.name, amount };
    }
  }
  return best;
}

export interface AppliedCoupon {
  couponId: number;
  couponCode: string;
  amount: number;
}

/**
 * 쿠폰 코드를 검증하고 할인액을 계산한다.
 *
 * **사용횟수를 소진하지 않는다.** 실제 redemption은 예약 저장 transaction에서 처리한다.
 * 다만 이미 한도가 찬 쿠폰은 견적 단계에서 미리 알려준다.
 */
export async function validateCoupon(input: {
  code: string;
  serviceType: string;
  productKey: string | null;
  amount: number;
  customerPhone?: string | null;
  now?: Date;
}): Promise<AppliedCoupon> {
  const code = normalizeCouponCode(input.code);
  if (!code) throw new CouponError("쿠폰 코드를 입력해주세요.", "COUPON_EMPTY");

  const coupon = await queryRow<CouponRow>("SELECT * FROM coupons WHERE code = ?", [code]);
  if (!coupon) throw new CouponError("존재하지 않는 쿠폰 코드입니다.", "COUPON_NOT_FOUND");

  const now = input.now ?? new Date();
  if (coupon.is_active !== 1) {
    throw new CouponError("사용이 중지된 쿠폰입니다.", "COUPON_INACTIVE");
  }
  const nowIso = now.toISOString();
  if (coupon.starts_at && nowIso < coupon.starts_at) {
    throw new CouponError("아직 사용할 수 없는 쿠폰입니다.", "COUPON_NOT_STARTED");
  }
  if (coupon.ends_at && nowIso > coupon.ends_at) {
    throw new CouponError("사용 기간이 지난 쿠폰입니다.", "COUPON_EXPIRED");
  }
  if (coupon.service_type && coupon.service_type !== input.serviceType) {
    throw new CouponError("이 서비스에는 사용할 수 없는 쿠폰입니다.", "COUPON_SERVICE_MISMATCH");
  }
  if (coupon.product_key && coupon.product_key !== input.productKey) {
    throw new CouponError("이 상품에는 사용할 수 없는 쿠폰입니다.", "COUPON_PRODUCT_MISMATCH");
  }
  if (input.amount < (coupon.min_amount ?? 0)) {
    throw new CouponError(
      `${coupon.min_amount.toLocaleString("ko-KR")}원 이상 결제 시 사용할 수 있습니다.`,
      "COUPON_MIN_AMOUNT"
    );
  }

  // 한도 확인 (소진하지 않는다 — 안내 목적)
  if (coupon.total_usage_limit != null) {
    const used = await queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = ?",
      [coupon.id]
    );
    if (Number(used?.c ?? 0) >= coupon.total_usage_limit) {
      throw new CouponError("사용 한도가 모두 소진된 쿠폰입니다.", "COUPON_EXHAUSTED");
    }
  }
  if (coupon.per_phone_limit != null && input.customerPhone) {
    const used = await queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = ? AND customer_phone = ?",
      [coupon.id, input.customerPhone]
    );
    if (Number(used?.c ?? 0) >= coupon.per_phone_limit) {
      throw new CouponError("이미 사용하신 쿠폰입니다.", "COUPON_PER_PHONE_LIMIT");
    }
  }

  const amount = computeDiscountAmount(coupon, input.amount);
  if (amount <= 0) {
    throw new CouponError("할인 조건을 만족하지 않습니다.", "COUPON_NO_DISCOUNT");
  }
  return { couponId: coupon.id, couponCode: coupon.code, amount };
}

export interface DiscountBreakdown {
  originalAmount: number;
  automaticDiscountAmount: number;
  couponDiscountAmount: number;
  promotionId: number | null;
  promotionName: string | null;
  couponId: number | null;
  couponCode: string | null;
  finalAmount: number;
}

/**
 * 견적 단계 할인 계산 (자동 프로모션 + 쿠폰).
 *
 * 관리자 수동 할인은 예약 생성 이후 adjustment이므로 여기 포함하지 않는다.
 * 쿠폰 오류는 호출부가 고객에게 알릴 수 있도록 그대로 던진다.
 */
export async function calculateDiscounts(input: {
  serviceType: string;
  productKey: string | null;
  originalAmount: number;
  couponCode?: string | null;
  customerPhone?: string | null;
  now?: Date;
}): Promise<DiscountBreakdown> {
  const original = Math.max(0, Math.round(input.originalAmount));
  let current = original;

  // 1) 자동 프로모션 — 가장 큰 할인 1개
  const promo = await pickBestPromotion({
    serviceType: input.serviceType,
    productKey: input.productKey,
    amount: current,
    now: input.now,
  });
  const automatic = promo?.amount ?? 0;
  current -= automatic;

  // 2) 쿠폰 — 자동 프로모션 적용 후 금액 기준
  let coupon: AppliedCoupon | null = null;
  if (input.couponCode?.trim()) {
    coupon = await validateCoupon({
      code: input.couponCode,
      serviceType: input.serviceType,
      productKey: input.productKey,
      amount: current,
      customerPhone: input.customerPhone,
      now: input.now,
    });
    current -= coupon.amount;
  }

  return {
    originalAmount: original,
    automaticDiscountAmount: automatic,
    couponDiscountAmount: coupon?.amount ?? 0,
    promotionId: promo?.promotionId ?? null,
    promotionName: promo?.promotionName ?? null,
    couponId: coupon?.couponId ?? null,
    couponCode: coupon?.couponCode ?? null,
    finalAmount: Math.max(0, current),
  };
}
