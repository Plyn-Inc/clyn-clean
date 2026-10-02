"use client";

import { useEffect, useMemo, useState } from "react";
import {
  HOUSE_SIZES_APARTMENT,
  HOUSE_TYPES_FIXED,
  JIPJEONGRI_PACKAGES,
  SERVICE_TYPES,
  serviceLabel,
} from "@/lib/types";

interface PriceRule {
  id: number;
  service_type: string;
  product_key: string | null;
  note: string | null;
  base_price: number;
  deposit_amount: number;
  is_active: number;
}

interface SimpleDiscount {
  id: number;
  name: string;
  is_active: number;
  discount_type: "fixed" | "percent";
  discount_value: number;
  max_discount_amount: number | null;
}

interface DiscountLink {
  price_rule_id: number;
  promotion_id: number;
}

type Msg = { type: "ok" | "err"; text: string } | null;

interface PricingOverview {
  rules: PriceRule[];
  promotions: SimpleDiscount[];
  links: DiscountLink[];
  holidaySurcharge: number;
}

let pricingOverviewCache: { data: PricingOverview; at: number } | null = null;
const PRICING_OVERVIEW_CACHE_MS = 30_000;

const HOUSE_PRODUCT_ORDER = [
  ...HOUSE_TYPES_FIXED,
  ...HOUSE_SIZES_APARTMENT.map((size) => `${size}평`),
] as string[];
const ORGANIZING_PRODUCT_ORDER = JIPJEONGRI_PACKAGES.map((item) => item.key);

function productOrderIndex(serviceType: string, productKey: string | null): number {
  if (!productKey) return 9999;
  const source = serviceType === "집정리" ? ORGANIZING_PRODUCT_ORDER : HOUSE_PRODUCT_ORDER;
  const index = source.indexOf(productKey);
  if (index >= 0) return index;
  const numeric = Number(productKey.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(numeric) ? 1000 + numeric : 9000;
}

function sortRules(rules: PriceRule[], serviceType: string): PriceRule[] {
  return rules
    .filter((rule) => rule.service_type === serviceType && rule.product_key)
    .slice()
    .sort((a, b) => {
      const diff =
        productOrderIndex(serviceType, a.product_key) -
        productOrderIndex(serviceType, b.product_key);
      return diff !== 0 ? diff : a.id - b.id;
    });
}

function productLabel(rule: PriceRule): string {
  if (rule.product_key === "40평") return "40평 이상";
  if (rule.service_type === "집정리") {
    const found = JIPJEONGRI_PACKAGES.find((item) => item.key === rule.product_key);
    if (found) return found.label;
  }
  return rule.note || rule.product_key || "-";
}

function discountAmount(discount: SimpleDiscount, currentAmount: number): number {
  if (currentAmount <= 0 || discount.is_active !== 1) return 0;
  let amount =
    discount.discount_type === "percent"
      ? Math.floor((currentAmount * discount.discount_value) / 100)
      : discount.discount_value;
  if (discount.max_discount_amount != null) {
    amount = Math.min(amount, discount.max_discount_amount);
  }
  return Math.max(0, Math.min(amount, currentAmount));
}

function calculateSelectedDiscounts(
  baseAmount: number,
  selected: SimpleDiscount[]
): { amount: number; finalAmount: number } {
  let current = Math.max(0, baseAmount);
  let totalDiscount = 0;
  for (const item of selected) {
    const amount = discountAmount(item, current);
    totalDiscount += amount;
    current -= amount;
  }
  return { amount: totalDiscount, finalAmount: Math.max(0, current) };
}

export default function AdminPricingPage() {
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [discounts, setDiscounts] = useState<SimpleDiscount[]>([]);
  const [links, setLinks] = useState<DiscountLink[]>([]);
  const [surcharge, setSurcharge] = useState("");
  const [tab, setTab] = useState<string>(SERVICE_TYPES[0]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [pickerRule, setPickerRule] = useState<PriceRule | null>(null);
  const [pickerIds, setPickerIds] = useState<number[]>([]);
  const [pickerSaving, setPickerSaving] = useState(false);

  async function load(force = false) {
    if (
      !force &&
      pricingOverviewCache &&
      Date.now() - pricingOverviewCache.at < PRICING_OVERVIEW_CACHE_MS
    ) {
      const cached = pricingOverviewCache.data;
      setRules(cached.rules);
      setSurcharge(String(cached.holidaySurcharge));
      setDiscounts(cached.promotions);
      setLinks(cached.links);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMsg(null);
    try {
      const response = await fetch("/api/admin/pricing-overview", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as Partial<PricingOverview> & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "가격 정보를 불러오지 못했습니다.");

      const overview: PricingOverview = {
        rules: data.rules ?? [],
        promotions: data.promotions ?? [],
        links: data.links ?? [],
        holidaySurcharge: Number(data.holidaySurcharge ?? 30000),
      };
      pricingOverviewCache = { data: overview, at: Date.now() };

      setRules(overview.rules);
      setSurcharge(String(overview.holidaySurcharge));
      setDiscounts(overview.promotions);
      setLinks(overview.links);
    } catch (error) {
      setMsg({
        type: "err",
        text: error instanceof Error ? error.message : "가격 정보를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tabRules = useMemo(() => sortRules(rules, tab), [rules, tab]);
  const activeDiscounts = useMemo(
    () => discounts.filter((item) => item.is_active === 1),
    [discounts]
  );

  function discountIdsForRule(ruleId: number): number[] {
    return links
      .filter((link) => link.price_rule_id === ruleId)
      .map((link) => link.promotion_id);
  }

  function selectedDiscountsForRule(ruleId: number): SimpleDiscount[] {
    const ids = new Set(discountIdsForRule(ruleId));
    return activeDiscounts.filter((item) => ids.has(item.id));
  }

  function openPicker(rule: PriceRule) {
    setPickerRule(rule);
    setPickerIds(discountIdsForRule(rule.id));
  }

  async function saveDiscountSelection() {
    if (!pickerRule) return;
    setPickerSaving(true);
    setMsg(null);
    const res = await fetch("/api/admin/price-discount-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceRuleId: pickerRule.id,
        promotionIds: pickerIds,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setPickerSaving(false);
    if (!res.ok) {
      setMsg({ type: "err", text: data.error || "할인 적용 저장에 실패했습니다." });
      return;
    }
    setLinks((current) => {
      const next = [
        ...current.filter((link) => link.price_rule_id !== pickerRule.id),
        ...pickerIds.map((promotionId) => ({
          price_rule_id: pickerRule.id,
          promotion_id: promotionId,
        })),
      ];
      pricingOverviewCache = null;
      return next;
    });
    setPickerRule(null);
    setMsg({ type: "ok", text: "할인 적용 항목을 저장했습니다." });
  }

  async function saveRule(rule: PriceRule, basePrice: number, deposit: number, active: boolean) {
    setSaving(`${rule.service_type}:${rule.product_key}`);
    setMsg(null);
    const res = await fetch("/api/admin/price-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "rule",
        id: rule.id,
        serviceType: rule.service_type,
        productKey: rule.product_key,
        areaMin: 0,
        areaMax: null,
        basePrice,
        depositAmount: deposit,
        isActive: active,
        note: rule.note ?? rule.product_key,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(null);
    if (res.ok) {
      setMsg({ type: "ok", text: "가격 설정을 저장했습니다." });
      await load(true);
    } else {
      setMsg({ type: "err", text: data.error || "저장 실패" });
    }
  }

  async function saveSurcharge() {
    setSaving("surcharge");
    setMsg(null);
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holiday_surcharge: surcharge }),
    });
    setSaving(null);
    if (res.ok) {
      pricingOverviewCache = null;
      setMsg({ type: "ok", text: "휴일 가산금을 저장했습니다." });
    }
    else setMsg({ type: "err", text: "휴일 가산금 저장에 실패했습니다." });
  }

  if (loading && rules.length === 0) {
    return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;
  }

  return (
    <div className="max-w-7xl space-y-8">
      <div>
        <h1 className="font-display text-xl font-bold">가격 관리</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
          견적금액을 설정하고, 할인정보에서 할인 관리에 등록된 항목을 중복 선택할 수 있습니다.
          선택된 할인 합계가 총결제금액에 바로 반영됩니다.
        </p>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          쿠폰과 예약일별 휴일 가산금은 고객이 실제 예약 조건을 선택할 때 서버에서 추가 계산됩니다.
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${
          msg.type === "ok"
            ? "bg-[var(--mint-soft)] text-[var(--mint)]"
            : "bg-[#FBEAE5] text-[var(--rose)]"
        }`}>
          {msg.text}
        </div>
      )}

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-sm font-semibold">휴일 가산금</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
          일요일 또는 공휴일 예약에 1회 가산됩니다. 토요일과 손없는날에는 가산하지 않습니다.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="number"
            min={0}
            value={surcharge}
            onChange={(e) => setSurcharge(e.target.value)}
            className="w-40 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
          />
          <span className="self-center text-xs text-[var(--ink-soft)]">원</span>
          <button
            disabled={saving === "surcharge"}
            onClick={saveSurcharge}
            className="rounded-lg bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving === "surcharge" ? "저장 중..." : "저장"}
          </button>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap gap-2">
          {SERVICE_TYPES.map((service) => (
            <button
              key={service}
              onClick={() => setTab(service)}
              className={`rounded-full border px-4 py-2 text-xs font-medium ${
                tab === service
                  ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                  : "border-[var(--line)] text-[var(--ink-soft)]"
              }`}
            >
              {serviceLabel(service)}
            </button>
          ))}
        </div>

        {tabRules.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--ink-soft)]">
            {serviceLabel(tab)} 가격 항목이 없습니다.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
            <div className="min-w-[1180px]">
              <div className="grid grid-cols-[130px_150px_220px_150px_150px_150px_70px_90px] items-center gap-2 border-b border-[var(--line)] bg-[var(--sand-deep)] px-4 py-3 text-xs font-semibold text-[var(--ink-soft)]">
                <span>상품</span>
                <span>견적금액</span>
                <span>할인정보</span>
                <span>총결제금액</span>
                <span>선금</span>
                <span>잔금</span>
                <span>활성</span>
                <span className="text-center">저장</span>
              </div>

              {tabRules.map((rule) => (
                <PriceRow
                  key={rule.id}
                  rule={rule}
                  selectedDiscounts={selectedDiscountsForRule(rule.id)}
                  isSaving={saving === `${rule.service_type}:${rule.product_key}`}
                  onChooseDiscount={() => openPicker(rule)}
                  onSave={(price, deposit, active) => saveRule(rule, price, deposit, active)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {pickerRule && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">할인정보 선택</h2>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                  {productLabel(pickerRule)}에 적용할 할인을 여러 개 선택할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerRule(null)}
                className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs"
              >
                닫기
              </button>
            </div>

            {activeDiscounts.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
                할인 관리에 등록된 활성 할인이 없습니다.
              </div>
            ) : (
              <div className="mt-5 max-h-[360px] space-y-2 overflow-y-auto">
                {activeDiscounts.map((discount) => {
                  const checked = pickerIds.includes(discount.id);
                  return (
                    <label
                      key={discount.id}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3"
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setPickerIds((current) =>
                              e.target.checked
                                ? [...current, discount.id]
                                : current.filter((id) => id !== discount.id)
                            )
                          }
                        />
                        <span className="text-sm font-medium">{discount.name}</span>
                      </span>
                      <span className="text-sm font-semibold text-[var(--mint)]">
                        {discount.discount_type === "percent"
                          ? `${discount.discount_value}%`
                          : `${discount.discount_value.toLocaleString("ko-KR")}원`}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPickerRule(null)}
                className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--ink-soft)]"
              >
                취소
              </button>
              <button
                type="button"
                disabled={pickerSaving}
                onClick={saveDiscountSelection}
                className="rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pickerSaving ? "저장 중..." : "선택 적용"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceRow({
  rule,
  selectedDiscounts,
  isSaving,
  onChooseDiscount,
  onSave,
}: {
  rule: PriceRule;
  selectedDiscounts: SimpleDiscount[];
  isSaving: boolean;
  onChooseDiscount: () => void;
  onSave: (basePrice: number, deposit: number, active: boolean) => void;
}) {
  const [price, setPrice] = useState(String(rule.base_price));
  const [deposit, setDeposit] = useState(String(rule.deposit_amount ?? 0));
  const [active, setActive] = useState(rule.is_active === 1);

  useEffect(() => {
    setPrice(String(rule.base_price));
    setDeposit(String(rule.deposit_amount ?? 0));
    setActive(rule.is_active === 1);
  }, [rule.base_price, rule.deposit_amount, rule.is_active]);

  const baseAmount = Math.max(0, Number(price) || 0);
  const configuredDeposit = Math.max(0, Number(deposit) || 0);
  const calculated = calculateSelectedDiscounts(baseAmount, selectedDiscounts);
  const actualDeposit = Math.min(configuredDeposit, calculated.finalAmount);
  const balance = Math.max(calculated.finalAmount - actualDeposit, 0);

  return (
    <div className="grid grid-cols-[130px_150px_220px_150px_150px_150px_70px_90px] items-center gap-2 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
      <span className="text-sm font-semibold">{productLabel(rule)}</span>

      <input
        aria-label="견적금액"
        type="number"
        min={0}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
      />

      <div>
        <button
          type="button"
          onClick={onChooseDiscount}
          className="rounded-lg border border-[var(--navy)] px-3 py-2 text-xs font-semibold text-[var(--navy)]"
        >
          할인 선택
        </button>
        <span className="ml-2 text-sm font-bold text-[var(--mint)]">
          -{calculated.amount.toLocaleString("ko-KR")}원
        </span>
        <p className="mt-1 truncate text-[10px] text-[var(--ink-soft)]">
          {selectedDiscounts.length > 0
            ? selectedDiscounts.map((item) => item.name).join(" + ")
            : "선택된 할인 없음"}
        </p>
      </div>

      <p className="text-sm font-bold text-[var(--ink)]">
        {calculated.finalAmount.toLocaleString("ko-KR")}원
      </p>

      <input
        aria-label="선금"
        type="number"
        min={0}
        value={deposit}
        onChange={(e) => setDeposit(e.target.value)}
        className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
      />

      <p className="text-sm font-semibold text-[var(--ink)]">
        {balance.toLocaleString("ko-KR")}원
      </p>

      <label className="flex items-center justify-center gap-1.5 text-xs">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        활성
      </label>

      <button
        disabled={isSaving}
        onClick={() => onSave(baseAmount, configuredDeposit, active)}
        className="rounded-lg bg-[var(--navy)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {isSaving ? "저장 중" : "저장"}
      </button>
    </div>
  );
}
