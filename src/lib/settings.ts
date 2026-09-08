import * as settingsRepo from "@/database/repositories/settings-repository";

export async function getSetting(key: string): Promise<string> {
  return (await settingsRepo.findValue(key)) ?? "";
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const key of keys) result[key] = await getSetting(key);
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
  name: string;
  phone: string;
  kakaoUrl: string;
  address: string;
  bizNumber: string;
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const s = await getSettings([
    "company_name",
    "company_phone",
    "company_kakao_url",
    "company_address",
    "company_biz_number",
  ]);
  return {
    name: s.company_name || "",
    phone: s.company_phone || "",
    kakaoUrl: s.company_kakao_url || "",
    address: s.company_address || "",
    bizNumber: s.company_biz_number || "",
  };
}
