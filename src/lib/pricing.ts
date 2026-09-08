import { execute, queryRows } from "@/database/connection";
import { getSetting } from "./settings";
import { JIPJEONGRI_PACKAGES } from "./types";

export interface PriceRule {
  id: number;
  service_type: string;
  area_min: number;
  area_max: number | null;
  base_price: number;
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

export const MOVE_IN_BASE_PRICES: Record<string, number> = {
  "원룸": 179000,
  "원룸 복층": 279000,
  "투룸": 269000,
  "쓰리룸": 319000,
  "18평": 329000,
  "24평": 369000,
  "28평": 420000,
  "32평": 459000,
  "34평": 489000,
  "38평": 539000,
  "40평": 579000,
};

export const SIZE_40_PLUS_LABEL = "40평 이상";
export const SIZE_40_PLUS_MIN = 579000;

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
    basePrice = (await getMoveInBasePrice("40평")) ?? 0;
    priceConfirmed = false;
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
    notice = `40평 이상은 기본 ${basePrice.toLocaleString("ko-KR")}원부터 시작하며, 실제 평수와 구조 확인 후 최종 견적을 안내드립니다.`;
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
      `UPDATE price_rules SET service_type=?, area_min=?, area_max=?, base_price=?, is_active=?, note=?, updated_at=datetime('now') WHERE id=?`,
      [rule.service_type, rule.area_min, rule.area_max ?? null, rule.base_price, rule.is_active, rule.note ?? null, rule.id]
    );
  } else {
    await execute(
      `INSERT INTO price_rules (service_type, area_min, area_max, base_price, is_active, note) VALUES (?, ?, ?, ?, ?, ?)`,
      [rule.service_type, rule.area_min, rule.area_max ?? null, rule.base_price, rule.is_active, rule.note ?? null]
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
