import { execute, queryRows } from "@/database/connection";
import { getSetting } from "./settings";
import {
  JIPJEONGRI_PACKAGES,
  DEFAULT_DEPOSIT_BY_HOUSE_TYPE,
  DEFAULT_BASE_PRICE_BY_HOUSE_TYPE,
  VAT_NOTICE,
  SIZE_40_PLUS_CONSULT_NOTICE,
} from "./types";
// Production 판정은 DB 캐시(special-days-store)를 단일 원천으로 사용한다.
// 코드 내 정적 목록(special-days.ts)은 backfill 보조 용도로만 남아 있다.
import { resolveDateSurcharge } from "./special-days-store";

export interface PriceRule {
  id: number;
  service_type: string;
  area_min: number;
  area_max: number | null;
  base_price: number;
  /** 평형별 예약 선금(원). 총 청소금액에 포함되며 추가 비용이 아니다. */
  deposit_amount: number;
  /** 상품 키 (주거형태/평형/패키지) */
  product_key: string | null;
  is_active: number;
  note: string | null;
}

export interface OptionPrice {
  id: number;
  option_key: string;
  option_label: string;
  price: number;
  is_active: number;
}

/**
 * 입주청소 기준가격.
 * 실제 값은 types.ts의 DEFAULT_BASE_PRICE_BY_HOUSE_TYPE 한 곳에서만 정의한다.
 * (가격을 여러 파일에 중복 하드코딩하지 않기 위함)
 */
export const MOVE_IN_BASE_PRICES: Record<string, number> = DEFAULT_BASE_PRICE_BY_HOUSE_TYPE;

export const SIZE_40_PLUS_LABEL = "40평 이상";
export const SIZE_40_PLUS_MIN = DEFAULT_BASE_PRICE_BY_HOUSE_TYPE["40평"];


export const JIPJEONGRI_PRICES: Record<string, number> = Object.fromEntries(
  JIPJEONGRI_PACKAGES.map((p) => [p.key, p.price])
);

export interface QuoteInput {
  serviceType: string;
  houseTypeKey?: string;
  actualPyeong?: number;
  jipjeongriPackage?: string;
  extraOptions?: string[];
  instantDiscountEligible?: boolean;
  /** 예약 희망일 — 날짜 조건 내부 가격 보정 판정에 사용 */
  desiredDate?: string;
  /** 반려동물 있음 여부 — 상담 전환 판정에 사용 */
  hasPet?: boolean;
}

export interface QuoteResult {
  serviceType: string;
  houseTypeKey: string;
  basePrice: number;
  multiplier: number;
  /** @deprecated 배수 미사용 — 항상 basePrice와 동일. 응답 계약 호환용 */
  priceAfterMultiplier: number;
  optionBreakdown: { key: string; label: string; price: number; isConsult: boolean }[];
  extraTotal: number;
  subtotal: number;
  instantDiscount: number;
  discountEligible: boolean;
  estimatedTotal: number;
  depositAmount: number;
  estimatedBalance: number;
  priceConfirmed: boolean;
  notice: string;
  calculatedAt: string;
  // --- 상담 전환 판정 (서버 단일 원천) ---
  /** true이면 자동 예약금/계좌 단계로 진행하지 않고 상담접수로 전환한다 */
  consultRequired: boolean;
  /** 상담 전환 사유 (내부 enum). 고객 응답에서는 제거된다 */
  consultReason: ConsultReason | null;
  /** 고객에게 보여줄 상담 안내 문구 */
  consultNotice: string | null;
  /**
   * 확정 견적이 아닌 "시작가" 여부.
   * true이면 estimatedTotal을 확정금액으로 표시하면 안 되고
   * "N원부터"로 표기해야 한다 (40평 이상 등).
   */
  isStartingPrice: boolean;
  /** 고객 표시용 금액 문자열. 확정가/시작가를 구분해 미리 조립한다 */
  displayPriceLabel: string;
  /**
   * 해당 서비스×상품의 price_rules row가 존재하고 활성 상태인지.
   *
   * false이면 가격표가 없거나 관리자가 비활성화한 상품이다.
   * 임의 가격을 만들지 않고 상담으로 전환해야 한다.
   */
  productAvailable: boolean;
  // --- 내부 감사용 (고객 응답에서는 제거된다) ---
  /** 날짜 조건 가격 보정이 적용됐는지 여부 */
  dateAdjustmentApplied: boolean;
  /** 적용된 보정 금액 */
  dateAdjustmentAmount: number;
}

/** 상담 전환 사유 */
export type ConsultReason = "size_40_plus" | "pet" | "price_unconfirmed";

/**
 * 고객에게 노출되는 안내 문구를 정화한다.
 *
 * 구 정책 문구(잔금 현장 안내 / VAT 별도)가 DB에 남아 있어도
 * public quote 응답에 다시 나타나지 않도록 막는다.
 */
function sanitizeCustomerNotice(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return VAT_NOTICE;
  const banned = [/잔금은?\s*작업\s*완료\s*후/, /VAT\s*별도/, /부가세\s*별도/];
  if (banned.some((re) => re.test(text))) return VAT_NOTICE;
  return text;
}

/**
 * 서비스 + 상품 조합의 가격을 직접 조회한다.
 *
 * 배수 계산을 하지 않는다. price_rules에 각 서비스의 독립 row가 존재한다.
 */
export interface ServiceProductPrice {
  basePrice: number;
  depositAmount: number;
  isActive: boolean;
}

export async function getServiceProductPrice(
  serviceType: string,
  productKey: string
): Promise<ServiceProductPrice | null> {
  const rules = await queryRows<PriceRule>(
    `SELECT * FROM price_rules
      WHERE service_type = ? AND product_key = ?
      ORDER BY id DESC
      LIMIT 1`,
    [serviceType, productKey]
  );
  if (rules.length === 0) return null;
  const r = rules[0];
  return {
    basePrice: Number(r.base_price ?? 0),
    depositAmount: Number(r.deposit_amount ?? 0),
    isActive: r.is_active === 1,
  };
}

/** 서비스의 활성 상품 목록 (가격 카드용) */
export async function listServiceProducts(serviceType: string): Promise<PriceRule[]> {
  return queryRows<PriceRule>(
    `SELECT * FROM price_rules
      WHERE service_type = ? AND product_key IS NOT NULL AND is_active = 1
      ORDER BY id ASC`,
    [serviceType]
  );
}

export async function getMoveInBasePrice(houseTypeKey: string): Promise<number | null> {
  const rules = await queryRows<PriceRule>(
    `SELECT * FROM price_rules
     WHERE service_type = '입주청소' AND note = ?
     ORDER BY id DESC
     LIMIT 1`,
    [houseTypeKey]
  );
  if (rules.length > 0) {
    const rule = rules[0];
    return rule.is_active === 1 && rule.base_price > 0 ? rule.base_price : null;
  }
  return MOVE_IN_BASE_PRICES[houseTypeKey] ?? null;
}

/**
 * 평형별 예약 선금을 조회한다.
 *
 * 우선순위:
 *   1. price_rules.deposit_amount (관리자가 수정 가능)
 *   2. DEFAULT_DEPOSIT_BY_HOUSE_TYPE 상수 (fallback)
 *
 * 예약 선금은 총 청소금액에 포함되는 금액이며 추가 비용이 아니다.
 */
export async function getDepositAmountForHouseType(houseTypeKey: string): Promise<number> {
  const rules = await queryRows<PriceRule>(
    `SELECT * FROM price_rules
     WHERE service_type = '입주청소' AND note = ?
     ORDER BY id DESC
     LIMIT 1`,
    [houseTypeKey]
  );
  if (rules.length > 0 && rules[0].is_active === 1) {
    const amount = Number(rules[0].deposit_amount ?? 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return DEFAULT_DEPOSIT_BY_HOUSE_TYPE[houseTypeKey] ?? 0;
}

export function getOptionPrices(activeOnly = true): Promise<OptionPrice[]> {
  const where = activeOnly ? " WHERE is_active = 1" : "";
  return queryRows<OptionPrice>(`SELECT * FROM option_prices${where} ORDER BY id ASC`);
}

export async function calculateQuote(input: QuoteInput): Promise<QuoteResult> {
  const [depositRaw, discountRaw, discountEnabledRaw, balanceNoticeRaw] = await Promise.all([
    getSetting("deposit_amount"),
    getSetting("instant_discount_amount"),
    getSetting("instant_discount_enabled"),
    getSetting("balance_notice"),
  ]);
  const fallbackDeposit = Number(depositRaw || 0);
  const discountAmount = Number(discountRaw || 0);
  const discountEnabled = discountEnabledRaw === "1";
  // settings.balance_notice에 구 값("잔금은 작업 완료 후 현장에서 안내드립니다." 등)이
  // 남아 있어도 고객 견적에 노출되지 않도록 코드 레벨에서 정화한다.
  // DB migration(20260910150000)과 이중 방어.
  const balanceNotice = sanitizeCustomerNotice(balanceNoticeRaw);

  // ── 상품 키 결정 ────────────────────────────────────────────────────────
  // 집정리는 패키지 키, 그 외는 주거형태/평형 키를 사용한다.
  const productKey =
    input.serviceType === "집정리"
      ? input.jipjeongriPackage || "1p4h"
      : input.houseTypeKey || "";
  const houseTypeKey = productKey;
  const is40Plus = productKey === "40평" || productKey === "40평 이상";

  // ── 서비스별 독립 가격 조회 (배수 계산 없음) ──────────────────────────────
  // 각 서비스는 price_rules(service_type, product_key)에 자신의 row를 가진다.
  const product = productKey
    ? await getServiceProductPrice(input.serviceType, is40Plus ? "40평" : productKey)
    : null;
  const basePrice = product?.basePrice ?? 0;
  const priceConfirmed = !is40Plus && product !== null && product.isActive && basePrice > 0;

  // 예약금도 서비스별로 독립이다. 해당 서비스×상품 row의 값을 사용하고,
  // 값이 없을 때만 전역 기본 설정으로 대체한다.
  const deposit = product && product.depositAmount > 0 ? product.depositAmount : fallbackDeposit;

  // 배수는 더 이상 runtime 계산에 쓰이지 않는다 (migration/seed에서 물리화됨)
  const multiplier = 1.0;
  // 서비스별 독립 가격이므로 별도 곱셈이 없다.
  // priceAfterMultiplier 필드는 기존 응답 계약 호환을 위해 basePrice를 그대로 담는다.
  const priceAfterMultiplier = basePrice;

  // 추가서비스는 예약 견적에서 제외됐다 (현장 확인 후 별도 안내)
  const optionBreakdown: QuoteResult["optionBreakdown"] = [];
  const extraTotal = 0;

  // ── 상담 전환 판정 (서버 단일 원천) ────────────────────────────────────
  // 40평 이상만 상담 전환 대상이다. (반려동물 상담 전환은 폐지됨)
  let consultRequired = false;
  let consultReason: ConsultReason | null = null;
  let consultNotice: string | null = null;

  if (is40Plus) {
    consultRequired = true;
    consultReason = "size_40_plus";
    consultNotice = SIZE_40_PLUS_CONSULT_NOTICE;
  } else if (!priceConfirmed) {
    consultRequired = true;
    consultReason = "price_unconfirmed";
    consultNotice = "견적 확인이 필요합니다. 상담 접수 후 담당자가 안내드립니다.";
  }

  // ── 휴일 가산금 ────────────────────────────────────────────────────────
  // 일요일 또는 공휴일에만 1회 가산한다. 토요일·손없는날은 가산하지 않는다.
  // 공휴일 캐시 조회가 실패해도 예약을 막지 않고 기본가격으로 진행한다.
  const surcharge = consultRequired
    ? { amount: 0, specialDayAvailable: true }
    : await resolveDateSurcharge(input.desiredDate);
  const dateAdjustmentAmount = surcharge.amount;
  const dateAdjustmentApplied = dateAdjustmentAmount > 0;

  const subtotal = priceAfterMultiplier + extraTotal + dateAdjustmentAmount;
  const eligible = input.instantDiscountEligible === true;
  const instantDiscount = discountEnabled && eligible ? discountAmount : 0;
  const estimatedTotal = Math.max(subtotal - instantDiscount, 0);
  const estimatedBalance = Math.max(estimatedTotal - deposit, 0);

  // 40평 이상은 확정 견적이 아니라 상담 참고 시작가다.
  // estimatedTotal을 "총 견적"으로 표시하지 않도록 플래그와 라벨을 함께 제공한다.
  const isStartingPrice = is40Plus;
  const displayPriceLabel = isStartingPrice
    ? `${basePrice.toLocaleString("ko-KR")}원부터`
    : `${estimatedTotal.toLocaleString("ko-KR")}원`;

  // 고객 안내 문구 — 가격 보정 사유는 절대 노출하지 않는다.
  let notice: string;
  if (consultRequired && consultNotice) {
    notice = consultNotice;
  } else {
    notice = VAT_NOTICE;
  }
  void balanceNotice; // 잔금 안내 문구는 고객 견적 영역에서 사용하지 않는다

  return {
    serviceType: input.serviceType,
    houseTypeKey,
    basePrice,
    multiplier,
    priceAfterMultiplier,
    optionBreakdown,
    extraTotal,
    subtotal,
    instantDiscount,
    discountEligible: discountEnabled && eligible,
    estimatedTotal,
    depositAmount: deposit,
    estimatedBalance,
    priceConfirmed,
    notice,
    calculatedAt: new Date().toISOString(),
    consultRequired,
    consultReason,
    consultNotice,
    isStartingPrice,
    displayPriceLabel,
    productAvailable: product !== null && product.isActive && basePrice > 0,
    dateAdjustmentApplied,
    dateAdjustmentAmount,
  };
}



// ---------------------------------------------------------------------------
// 관리자용 CRUD
// ---------------------------------------------------------------------------

export function listPriceRules(): Promise<PriceRule[]> {
  return queryRows<PriceRule>("SELECT * FROM price_rules ORDER BY service_type, area_min");
}

export async function upsertPriceRule(rule: Omit<PriceRule, "id"> & { id?: number }): Promise<void> {
  if (rule.id) {
    await execute(
      `UPDATE price_rules SET service_type=?, area_min=?, area_max=?, base_price=?, deposit_amount=?, is_active=?, note=?, product_key=?, updated_at=datetime('now') WHERE id=?`,
      [rule.service_type, rule.area_min, rule.area_max ?? null, rule.base_price, rule.deposit_amount ?? 0, rule.is_active, rule.note ?? null, rule.product_key ?? rule.note ?? null, rule.id]
    );
  } else {
    await execute(
      `INSERT INTO price_rules (service_type, area_min, area_max, base_price, deposit_amount, is_active, note, product_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [rule.service_type, rule.area_min, rule.area_max ?? null, rule.base_price, rule.deposit_amount ?? 0, rule.is_active, rule.note ?? null, rule.product_key ?? rule.note ?? null]
    );
  }
}

export function deletePriceRule(id: number): Promise<void> {
  return execute("DELETE FROM price_rules WHERE id = ?", [id]);
}

export function updateOptionPrice(optionKey: string, price: number, isActive: boolean): Promise<void> {
  return execute(
    `UPDATE option_prices SET price=?, is_active=?, updated_at=datetime('now') WHERE option_key=?`,
    [price, isActive ? 1 : 0, optionKey]
  );
}
