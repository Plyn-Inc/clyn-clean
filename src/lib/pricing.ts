import { execute, queryRows } from "@/database/connection";
import { getSetting } from "./settings";
import { JIPJEONGRI_PACKAGES, DEFAULT_DEPOSIT_BY_HOUSE_TYPE, DEFAULT_BASE_PRICE_BY_HOUSE_TYPE } from "./types";

export interface PriceRule {
  id: number;
  service_type: string;
  area_min: number;
  area_max: number | null;
  base_price: number;
  /** 평형별 예약 선금(원). 총 청소금액에 포함되며 추가 비용이 아니다. */
  deposit_amount: number;
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

export const SERVICE_MULTIPLIER: Record<string, number> = {
  "입주청소": 1.0,
  "사이청소": 1.5,
  "거주청소": 1.1,
};

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
}

export interface QuoteResult {
  serviceType: string;
  houseTypeKey: string;
  basePrice: number;
  multiplier: number;
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
  const deposit = Number(depositRaw || 0);
  const discountAmount = Number(discountRaw || 0);
  const discountEnabled = discountEnabledRaw === "1";
  const balanceNotice = balanceNoticeRaw || "잔금은 작업 완료 후 현장에서 안내드립니다.";

  if (input.serviceType === "집정리") {
    return calculateJipjeongriQuote(input, deposit, discountAmount, discountEnabled, balanceNotice);
  }

  const houseTypeKey = input.houseTypeKey || "";
  const multiplier = SERVICE_MULTIPLIER[input.serviceType] ?? 1.0;
  const is40Plus = houseTypeKey === "40평" || houseTypeKey === "40평 이상";

  let basePrice: number;
  let priceConfirmed: boolean;

  if (is40Plus) {
    // 40평 이상은 529,000원 정식 가격표 상품이다.
    // 관리자 별도견적 입력 없이 고객이 계좌 단계까지 진행할 수 있어야 한다.
    // (정식 가격표 밖의 특수 케이스만 관리자가 최종금액을 입력한다)
    const bp40 = await getMoveInBasePrice("40평");
    basePrice = bp40 ?? 0;
    priceConfirmed = bp40 !== null && bp40 > 0;
  } else {
    const bp = await getMoveInBasePrice(houseTypeKey);
    basePrice = bp ?? 0;
    priceConfirmed = bp !== null && bp > 0;
  }

  const priceAfterMultiplier = Math.round(basePrice * multiplier);
  const optionPriceMap = new Map((await getOptionPrices()).map((o) => [o.option_key, o]));
  const optionBreakdown: QuoteResult["optionBreakdown"] = [];
  let extraTotal = 0;

  for (const key of input.extraOptions ?? []) {
    const opt = optionPriceMap.get(key);
    if (opt) {
      const isConsult = opt.price === 0;
      optionBreakdown.push({ key, label: opt.option_label, price: opt.price, isConsult });
      extraTotal += opt.price;
    }
  }

  const subtotal = priceAfterMultiplier + extraTotal;
  const eligible = input.instantDiscountEligible === true;
  const instantDiscount = discountEnabled && eligible ? discountAmount : 0;
  const estimatedTotal = Math.max(subtotal - instantDiscount, 0);
  const estimatedBalance = Math.max(estimatedTotal - deposit, 0);

  let notice: string;
  if (is40Plus) {
    notice =
      `40평 이상 기준 금액입니다. ` +
      `실제 공급면적과 현장 구조에 따라 추가요금이 발생할 수 있으며, 사전에 안내드립니다.`;
  } else if (!priceConfirmed) {
    notice = "견적을 확인할 수 없습니다. 상담을 통해 안내드립니다.";
  } else {
    notice = balanceNotice || "최종 금액은 현장 확인 후 달라질 수 있습니다.";
  }

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
  };
}

function calculateJipjeongriQuote(
  input: QuoteInput,
  deposit: number,
  discountAmount: number,
  discountEnabled: boolean,
  balanceNotice: string
): QuoteResult {
  const packageKey = input.jipjeongriPackage || "1p4h";
  const basePrice = JIPJEONGRI_PRICES[packageKey] ?? JIPJEONGRI_PRICES["1p4h"] ?? 129000;
  const eligible = input.instantDiscountEligible === true;
  const instantDiscount = discountEnabled && eligible ? discountAmount : 0;
  const estimatedTotal = Math.max(basePrice - instantDiscount, 0);
  return {
    serviceType: "집정리",
    houseTypeKey: packageKey,
    basePrice,
    multiplier: 1.0,
    priceAfterMultiplier: basePrice,
    optionBreakdown: [],
    extraTotal: 0,
    subtotal: basePrice,
    instantDiscount,
    discountEligible: discountEnabled && eligible,
    estimatedTotal,
    depositAmount: deposit,
    estimatedBalance: Math.max(estimatedTotal - deposit, 0),
    priceConfirmed: basePrice > 0,
    notice: "폐기물 처리 및 폐기차 비용은 별도 안내드립니다.\n" + (balanceNotice || ""),
    calculatedAt: new Date().toISOString(),
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
      `UPDATE price_rules SET service_type=?, area_min=?, area_max=?, base_price=?, deposit_amount=?, is_active=?, note=?, updated_at=datetime('now') WHERE id=?`,
      [rule.service_type, rule.area_min, rule.area_max ?? null, rule.base_price, rule.deposit_amount ?? 0, rule.is_active, rule.note ?? null, rule.id]
    );
  } else {
    await execute(
      `INSERT INTO price_rules (service_type, area_min, area_max, base_price, deposit_amount, is_active, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rule.service_type, rule.area_min, rule.area_max ?? null, rule.base_price, rule.deposit_amount ?? 0, rule.is_active, rule.note ?? null]
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
