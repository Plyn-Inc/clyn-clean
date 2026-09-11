import { execute, queryRows } from "@/database/connection";
import { getSetting } from "./settings";
import {
  JIPJEONGRI_PACKAGES,
  DEFAULT_DEPOSIT_BY_HOUSE_TYPE,
  DEFAULT_BASE_PRICE_BY_HOUSE_TYPE,
  VAT_NOTICE,
  SIZE_40_PLUS_CONSULT_NOTICE,
  PET_CONSULT_NOTICE,
} from "./types";
// Production 판정은 DB 캐시(special-days-store)를 단일 원천으로 사용한다.
// 코드 내 정적 목록(special-days.ts)은 backfill 보조 용도로만 남아 있다.
import { getDateAdjustmentFromStore } from "./special-days-store";

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
  // settings.balance_notice에 구 값("잔금은 작업 완료 후 현장에서 안내드립니다." 등)이
  // 남아 있어도 고객 견적에 노출되지 않도록 코드 레벨에서 정화한다.
  // DB migration(20260910150000)과 이중 방어.
  const balanceNotice = sanitizeCustomerNotice(balanceNoticeRaw);

  if (input.serviceType === "집정리") {
    return await calculateJipjeongriQuote(input, deposit, discountAmount, discountEnabled, balanceNotice);
  }

  const houseTypeKey = input.houseTypeKey || "";
  const multiplier = SERVICE_MULTIPLIER[input.serviceType] ?? 1.0;
  const is40Plus = houseTypeKey === "40평" || houseTypeKey === "40평 이상";

  let basePrice: number;
  let priceConfirmed: boolean;

  if (is40Plus) {
    // 40평 이상은 확정 자동견적 상품이 아니다 (상담 전환 대상).
    // 표시 시작가만 제공하고 예약금/계좌 단계로 진행하지 않는다.
    const bp40 = await getMoveInBasePrice("40평");
    basePrice = bp40 ?? 0;
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

  // ── 상담 전환 판정 (서버 단일 원천) ────────────────────────────────────
  // 40평 이상 / 반려동물 있음은 자동 예약금 단계로 보내지 않는다.
  let consultRequired = false;
  let consultReason: ConsultReason | null = null;
  let consultNotice: string | null = null;

  if (is40Plus) {
    consultRequired = true;
    consultReason = "size_40_plus";
    consultNotice = SIZE_40_PLUS_CONSULT_NOTICE;
  } else if (input.hasPet === true) {
    consultRequired = true;
    consultReason = "pet";
    consultNotice = PET_CONSULT_NOTICE;
  } else if (!priceConfirmed) {
    consultRequired = true;
    consultReason = "price_unconfirmed";
    consultNotice = "견적 확인이 필요합니다. 상담 접수 후 담당자가 안내드립니다.";
  }

  // ── 날짜 조건 내부 가격 보정 ───────────────────────────────────────────
  // 토/일/공휴일/손없는날 중 하나라도 해당하면 30,000원을 한 번만 가산한다.
  // 상담 전환 건에는 확정 자동견적을 만들지 않으므로 가산하지 않는다.
  // 날짜 보정은 DB 캐시에서 판정한다. 캐시에 없으면 SpecialDayNotSyncedError가 발생해
  // 금액이 잘못 확정되지 않는다 (일반일로 간주하지 않음).
  const dateAdjustmentAmount = consultRequired ? 0 : await getDateAdjustmentFromStore(input.desiredDate);
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
    dateAdjustmentApplied,
    dateAdjustmentAmount,
  };
}

async function calculateJipjeongriQuote(
  input: QuoteInput,
  deposit: number,
  discountAmount: number,
  discountEnabled: boolean,
  balanceNotice: string
): Promise<QuoteResult> {
  const packageKey = input.jipjeongriPackage || "1p4h";
  const basePrice = JIPJEONGRI_PRICES[packageKey] ?? JIPJEONGRI_PRICES["1p4h"] ?? 129000;

  // 반려동물 있음은 집정리에서도 상담 전환 대상이다.
  const petConsult = input.hasPet === true;
  // 상담 전환 건에는 확정 자동견적을 만들지 않으므로 날짜 보정도 적용하지 않는다.
  const dateAdjustmentAmount = petConsult ? 0 : await getDateAdjustmentFromStore(input.desiredDate);
  const dateAdjustmentApplied = dateAdjustmentAmount > 0;

  const eligible = input.instantDiscountEligible === true;
  const instantDiscount = discountEnabled && eligible ? discountAmount : 0;
  const estimatedTotal = Math.max(basePrice + dateAdjustmentAmount - instantDiscount, 0);
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
    notice:
      "폐기물 처리 및 폐기차 비용은 별도 안내드립니다.\n" +
      sanitizeCustomerNotice(balanceNotice),
    calculatedAt: new Date().toISOString(),
    consultRequired: petConsult,
    consultReason: petConsult ? "pet" : null,
    consultNotice: petConsult ? PET_CONSULT_NOTICE : null,
    isStartingPrice: false,
    displayPriceLabel: `${estimatedTotal.toLocaleString("ko-KR")}원`,
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
