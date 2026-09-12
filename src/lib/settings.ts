import * as settingsRepo from "@/database/repositories/settings-repository";

export async function getSetting(key: string): Promise<string> {
  return (await settingsRepo.findValue(key)) ?? "";
}

/**
 * 여러 설정 key를 1회 SELECT로 조회한다.
 * key 개수만큼 순차 round-trip을 만들지 않는다.
 */
export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const found = await settingsRepo.findValues(keys);
  const result: Record<string, string> = {};
  for (const key of keys) result[key] = found[key] ?? "";
  return result;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await settingsRepo.findAll();
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function setSetting(key: string, value: string): Promise<void> {
  return settingsRepo.upsertValue(key, value);
}

export async function setSettings(values: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(values)) await setSetting(key, value);
}

export async function isPricingConfirmed(): Promise<boolean> {
  const base = Number((await getSetting("base_price_TODO")) || 0);
  return base > 0;
}

export interface PricingSettings {
  basePrice: number;
  depositAmount: number;
  instantDiscountAmount: number;
  balanceNotice: string;
  basePriceConfirmed: boolean;
}

export async function getPricingSettings(): Promise<PricingSettings> {
  const s = await getSettings(["base_price_TODO", "deposit_amount", "instant_discount_amount", "balance_notice"]);
  return {
    basePrice: Number(s.base_price_TODO || 0),
    depositAmount: Number(s.deposit_amount || 0),
    instantDiscountAmount: Number(s.instant_discount_amount || 0),
    balanceNotice: s.balance_notice || "",
    basePriceConfirmed: Number(s.base_price_TODO || 0) > 0,
  };
}

export interface BankSettings {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  paymentDueHours: number;
}

export async function getBankSettings(): Promise<BankSettings> {
  const s = await getSettings(["bank_name", "bank_account_number", "bank_account_holder", "payment_due_hours"]);
  return {
    bankName: s.bank_name || "",
    accountNumber: s.bank_account_number || "",
    accountHolder: s.bank_account_holder || "",
    paymentDueHours: Number(s.payment_due_hours || 24),
  };
}

export interface ReservationReadiness {
  ready: boolean;
  missingFields: string[];
}

export async function checkReservationReadiness(): Promise<ReservationReadiness> {
  const [pricing, bank] = await Promise.all([getPricingSettings(), getBankSettings()]);
  const missing: string[] = [];
  if (!(pricing.depositAmount > 0)) missing.push("예약금 금액");
  if (!bank.bankName) missing.push("입금 은행명");
  if (!bank.accountNumber) missing.push("입금 계좌번호");
  if (!bank.accountHolder) missing.push("예금주");
  if (!(bank.paymentDueHours > 0)) missing.push("입금 기한");
  return { ready: missing.length === 0, missingFields: missing };
}

export interface CompanySettings {
  /** @deprecated 브랜드는 brandName, 법인은 legalCompanyName을 사용하세요 */
  name: string;
  phone: string;
  kakaoUrl: string;
  address: string;
  bizNumber: string;
  // --- 브랜드와 법적 운영주체 분리 ---
  /** 고객에게 노출되는 브랜드명 */
  brandName: string;
  /** 법적 운영주체 (국문) */
  legalCompanyName: string;
  /** 법적 운영주체 (영문) */
  legalCompanyNameEn: string;
  /** 통신판매업 신고번호 */
  mailOrderNumber: string;
}

/** 브랜드/법인 fallback — settings에 값이 없을 때 사용 */
export const BRAND_FALLBACK = {
  brandName: "CLYN CLEAN CARE",
  legalCompanyName: "주식회사 플린",
  legalCompanyNameEn: "Plyn Inc.",
  phone: "070-4155-5403",
  address: "경기도 의정부시 경의로 19, 경원빌딘 301호",
  bizNumber: "792-81-04045",
  mailOrderNumber: "제 2026-의정부흥선-0327 호",
} as const;

/**
 * 사이트 SEO 기본값.
 *
 * RootLayout/generateMetadata는 first HTML critical path이므로
 * DB를 기다리지 않고 이 상수를 사용한다.
 * (관리자 SEO 설정의 실시간 반영보다 홈페이지 가용성·응답속도를 우선)
 */
export const SITE_SEO_FALLBACK = {
  title: "CLYN CLEAN CARE | 입주청소 예약",
  description:
    "예약 가능 날짜를 바로 확인하고, 캘린더 또는 바로 예약하기로 간편하게 예약하세요.",
} as const;

/** DB 조회 실패 시 사용할 회사 기본정보 */
export function fallbackCompanySettings(): CompanySettings {
  return {
    name: BRAND_FALLBACK.brandName,
    phone: BRAND_FALLBACK.phone,
    kakaoUrl: "",
    address: BRAND_FALLBACK.address,
    bizNumber: BRAND_FALLBACK.bizNumber,
    brandName: BRAND_FALLBACK.brandName,
    legalCompanyName: BRAND_FALLBACK.legalCompanyName,
    legalCompanyNameEn: BRAND_FALLBACK.legalCompanyNameEn,
    mailOrderNumber: BRAND_FALLBACK.mailOrderNumber,
  };
}

/**
 * 회사 정보 조회 — DB 실패 시에도 페이지가 렌더링되도록 fallback을 반환한다.
 *
 * 회사 기본정보는 브랜드 상수로 대체 가능하므로, 조회 실패 때문에
 * 홈페이지 전체가 빈 화면/500이 되면 안 된다.
 * 예약 등 DB가 꼭 필요한 기능의 오류는 해당 기능에서 별도로 표시한다.
 */
export async function getCompanySettingsSafe(): Promise<CompanySettings> {
  try {
    return await getCompanySettings();
  } catch (e) {
    console.error("[settings] 회사 정보 조회 실패 — 브랜드 기본값으로 렌더링합니다.", e);
    return fallbackCompanySettings();
  }
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const s = await getSettings([
    "company_name",
    "company_phone",
    "company_kakao_url",
    "company_address",
    "company_biz_number",
    "brand_name",
    "legal_company_name",
    "legal_company_name_en",
    "company_mail_order_number",
  ]);
  return {
    name: s.company_name || BRAND_FALLBACK.brandName,
    phone: s.company_phone || BRAND_FALLBACK.phone,
    kakaoUrl: s.company_kakao_url || "",
    address: s.company_address || BRAND_FALLBACK.address,
    bizNumber: s.company_biz_number || BRAND_FALLBACK.bizNumber,
    brandName: s.brand_name || BRAND_FALLBACK.brandName,
    legalCompanyName: s.legal_company_name || BRAND_FALLBACK.legalCompanyName,
    legalCompanyNameEn: s.legal_company_name_en || BRAND_FALLBACK.legalCompanyNameEn,
    mailOrderNumber: s.company_mail_order_number || BRAND_FALLBACK.mailOrderNumber,
  };
}
