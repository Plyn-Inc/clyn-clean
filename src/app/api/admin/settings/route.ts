import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { getAllSettings, setSettings } from "@/lib/settings";

const ALLOWED_KEYS = new Set([
  "base_price_TODO",
  "deposit_amount",
  "instant_discount_amount",
  "instant_discount_enabled",   // 즉시예약 할인 활성화 여부 ("0"|"1")
  "balance_notice",
  "bank_name",
  "bank_account_number",
  "bank_account_holder",
  "payment_due_hours",
  "default_daily_capacity",
  // legacy — 브랜드/법인 분리 이후 신규 UI에서는 사용하지 않는다 (하위 호환 유지)
  "company_name",
  // 브랜드와 법적 운영주체 분리
  "brand_name",
  "legal_company_name",
  "legal_company_name_en",
  "company_mail_order_number",
  "company_phone",
  "company_kakao_url",
  "company_address",
  "company_biz_number",
  "site_title",
  "site_description",
  "privacy_policy_content",
  "terms_content",
  "refund_policy_content",
]);

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const settings = await getAllSettings();
  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_KEYS.has(key)) {
      updates[key] = String(value ?? "");
    }
  }

  await setSettings(updates);
  return NextResponse.json({ ok: true });
}
