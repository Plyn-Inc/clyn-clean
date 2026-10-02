"use client";

import Link from "next/link";
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

interface PromotionRule {
  id: number;
  name: string;
  is_active: number;
  discount_type: "fixed" | "percent";
  discount_value: number;
  starts_at: string | null;
  ends_at: string | null;
  service_type: string | null;
  product_key: string | null;
  min_amount: number;
  max_discount_amount: number | null;
  priority?: number;
}

type Msg = { type: "ok" | "err"; text: string } | null;

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
      const orderDiff =
        productOrderIndex(serviceType, a.product_key) -
        productOrderIndex(serviceType, b.product_key);
      if (orderDiff !== 0) return orderDiff;
      return a.id - b.id;
    });
}

function computeRuleDiscount(rule: PromotionRule, baseAmount: number): number {
  if (baseAmount <= 0) return 0;
  let amount =
    rule.discount_type === "percent"
      ? Math.floor((baseAmount * Number(rule.discount_value || 0)) / 100)
      : Number(rule.discount_value || 0);

  if (rule.max_discount_amount != null && rule.max_discount_amount >= 0) {
    amount = Math.min(amount, rule.max_discount_amount);
  }
  return Math.max(0, Math.min(amount, baseAmount));
}

function currentPromotionFor(
  promotions: PromotionRule[],
  serviceType: string,
  productKey: string | null,
  baseAmount: number
): { name: string; amount: number } | null {
  const nowIso = new Date().toISOString();

  const candidates = promotions
    .filter((rule) => {
      if (rule.is_active !== 1) return false;
      if (rule.starts_at && nowIso < rule.starts_at) return false;
      if (rule.ends_at && nowIso > rule.ends_at) return false;
      if (rule.service_type && rule.service_type !== serviceType) return false;
      if (rule.product_key && rule.product_key !== productKey) return false;
      if (baseAmount < Number(rule.min_amount || 0)) return false;
      return true;
    })
    .sort((a, b) => {
      const priorityDiff = Number(b.priority ?? 0) - Number(a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.id - b.id;
    });

  let best: { name: string; amount: number } | null = null;
  for (const rule of candidates) {
    const amount = computeRuleDiscount(rule, baseAmount);
    if (amount <= 0) continue;
    if (!best || amount > best.amount) best = { name: rule.name, amount };
  }
  return best;
}

function productLabel(rule: PriceRule): string {
  if (rule.product_key === "40평") return "40평 이상";
  if (rule.service_type === "집정리") {
    const found = JIPJEONGRI_PACKAGES.find((item) => item.key === rule.product_key);
    if (found) return found.label;
  }
  return rule.note || rule.product_key || "-";
}

const EMPTY_EVENT = {
  name: "이벤트 할인",
  productKey: "",
  discountType: "fixed" as "fixed" | "percent",
  discountValue: "0",
  startsAt: "",
  endsAt: "",
  minAmount: "0",
  maxDiscountAmount: "",
  priority: "100",
  isActive: true,
};

/**
 * 가격 관리.
 *
 * 가격 → 현재 자동 이벤트 할인 → 실제 결제금액 → 선금 → 잔금을
 * 같은 행에서 확인한다. 이벤트 할인은 /api/admin/discounts의 자동 프로모션과
 * 같은 데이터/계산 규칙을 사용하므로 고객 견적과 분리된 별도 할인값을 만들지 않는다.
 */
export default function AdminPricingPage() {
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [promotions, setPromotions] = useState<PromotionRule[]>([]);
  const [surcharge, setSurcharge] = useState("");
  const [tab, setTab] = useState<string>(SERVICE_TYPES[0]);
  const [loading, setLoading] = useState(true);
  const [priceLoadError, setPriceLoadError] = useState<string | null>(null);
  const [discountLoadError, setDiscountLoadError] = useState<string | null>(null);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [eventForm, setEventForm] = useState({ ...EMPTY_EVENT });
  const [editingPromotionId, setEditingPromotionId] = useState<number | null>(null);
  const [eventSaving, setEventSaving] = useState(false);

  async function load() {
    setLoading(true);
    setPriceLoadError(null);
    setDiscountLoadError(null);
    setSettingsLoadError(null);

    const [priceResult, settingsResult, discountResult] = await Promise.allSettled([
      fetch("/api/admin/price-rules", { cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `가격 API ${response.status}`);
        return data;
      }),
      fetch("/api/admin/settings", { cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `설정 API ${response.status}`);
        return data;
      }),
      fetch("/api/admin/discounts", { cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `할인 API ${response.status}`);
        return data;
      }),
    ]);

    if (priceResult.status === "fulfilled") {
      setRules(priceResult.value.rules ?? []);
    } else {
      setPriceLoadError("가격 정보를 불러오지 못했습니다.");
    }

    if (settingsResult.status === "fulfilled") {
      setSurcharge(String(settingsResult.value.settings?.holiday_surcharge ?? "30000"));
    } else {
      setSettingsLoadError("휴일 가산금 설정을 불러오지 못했습니다.");
    }

    if (discountResult.status === "fulfilled") {
      setPromotions(discountResult.value.promotions ?? []);
    } else {
      setDiscountLoadError("이벤트 할인 정보를 불러오지 못했습니다.");
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setEditingPromotionId(null);
    setEventForm({ ...EMPTY_EVENT });
  }, [tab]);

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
      await load();
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
    if (res.ok) setMsg({ type: "ok", text: "휴일 가산금을 저장했습니다." });
    else setMsg({ type: "err", text: "휴일 가산금 저장에 실패했습니다." });
  }

  function resetEventForm() {
    setEditingPromotionId(null);
    setEventForm({ ...EMPTY_EVENT });
  }

  function editPromotion(rule: PromotionRule) {
    setEditingPromotionId(rule.id);
    setEventForm({
      name: rule.name,
      productKey: rule.product_key ?? "",
      discountType: rule.discount_type,
      discountValue: String(rule.discount_value ?? 0),
      startsAt: rule.starts_at?.slice(0, 16) ?? "",
      endsAt: rule.ends_at?.slice(0, 16) ?? "",
      minAmount: String(rule.min_amount ?? 0),
      maxDiscountAmount: rule.max_discount_amount?.toString() ?? "",
      priority: String(rule.priority ?? 0),
      isActive: rule.is_active === 1,
    });
  }

  async function saveEventPromotion() {
    const discountValue = Number(eventForm.discountValue);
    if (!eventForm.name.trim()) {
      setMsg({ type: "err", text: "이벤트 할인 이름을 입력해주세요." });
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      setMsg({ type: "err", text: "할인값은 0보다 커야 합니다." });
      return;
    }

    setEventSaving(true);
    setMsg(null);
    const res = await fetch("/api/admin/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "promotion",
        id: editingPromotionId ?? undefined,
        name: eventForm.name.trim(),
        isActive: eventForm.isActive,
        discountType: eventForm.discountType,
        discountValue,
        startsAt: eventForm.startsAt || null,
        endsAt: eventForm.endsAt || null,
        serviceType: tab,
        productKey: eventForm.productKey || null,
        minAmount: Number(eventForm.minAmount) || 0,
        maxDiscountAmount: eventForm.maxDiscountAmount
          ? Number(eventForm.maxDiscountAmount)
          : null,
        priority: Number(eventForm.priority) || 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setEventSaving(false);

    if (!res.ok) {
      setMsg({ type: "err", text: data.error || "이벤트 할인 저장에 실패했습니다." });
      return;
    }

    setMsg({
      type: "ok",
      text: editingPromotionId ? "이벤트 할인을 수정했습니다." : "이벤트 할인을 등록했습니다.",
    });
    resetEventForm();
    await load();
  }

  async function removePromotion(id: number) {
    if (!confirm("이 이벤트 할인을 삭제할까요?")) return;
    setMsg(null);
    const res = await fetch(`/api/admin/discounts?kind=promotion&id=${id}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ type: "err", text: data.error || "이벤트 할인 삭제에 실패했습니다." });
      return;
    }
    if (editingPromotionId === id) resetEventForm();
    setMsg({ type: "ok", text: "이벤트 할인을 삭제했습니다." });
    await load();
  }

  const tabRules = useMemo(() => sortRules(rules, tab), [rules, tab]);
  const visiblePromotions = useMemo(
    () =>
      promotions
        .filter((promotion) => !promotion.service_type || promotion.service_type === tab)
        .slice()
        .sort((a, b) => {
          const globalDiff = Number(Boolean(a.service_type)) - Number(Boolean(b.service_type));
          if (globalDiff !== 0) return globalDiff;
          const priorityDiff = Number(b.priority ?? 0) - Number(a.priority ?? 0);
          if (priorityDiff !== 0) return priorityDiff;
          return a.id - b.id;
        }),
    [promotions, tab]
  );

  if (loading && rules.length === 0) {
    return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;
  }

  return (
    <div className="max-w-7xl space-y-8">
      <div>
        <h1 className="font-display text-xl font-bold">가격 관리</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
          상품은 작은 규모부터 큰 규모 순으로 정렬됩니다. 각 행에서 견적금액과 현재 이벤트 할인을 기준으로
          총결제금액·선금·잔금을 바로 확인할 수 있습니다.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
          총결제금액은 현재 자동 이벤트 할인 기준이며 쿠폰과 예약일별 휴일 가산금은 포함하지 않습니다.
          실제 고객 견적에서는 예약 날짜와 쿠폰 조건까지 서버에서 최종 계산합니다.
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

      {(priceLoadError || discountLoadError || settingsLoadError) && (
        <div className="rounded-xl bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              {priceLoadError && <p>{priceLoadError}</p>}
              {discountLoadError && <p>{discountLoadError} 가격표는 계속 사용할 수 있습니다.</p>}
              {settingsLoadError && <p>{settingsLoadError} 가격표는 계속 사용할 수 있습니다.</p>}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded-full border border-current px-4 py-2 text-xs font-semibold"
            >
              다시 불러오기
            </button>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-sm font-semibold">휴일 가산금</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
          일요일 또는 공휴일 예약에 1회 가산됩니다. 토요일과 손없는날에는 가산하지 않습니다.
          조건이 겹쳐도 중복 가산되지 않습니다.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="number"
            min={0}
            disabled={Boolean(settingsLoadError)}
            value={surcharge}
            onChange={(e) => setSurcharge(e.target.value)}
            className="w-40 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
          />
          <span className="self-center text-xs text-[var(--ink-soft)]">원</span>
          <button
            disabled={saving === "surcharge" || Boolean(settingsLoadError)}
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

        {priceLoadError ? (
          <p className="mt-5 rounded-xl border border-dashed border-[var(--line)] bg-white p-5 text-sm text-[var(--ink-soft)]">
            가격표를 불러오지 못했습니다. 위의 다시 불러오기를 눌러주세요.
          </p>
        ) : tabRules.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--ink-soft)]">
            {serviceLabel(tab)} 가격 항목이 없습니다.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
            <div className="min-w-[1120px]">
              <div className="grid grid-cols-[130px_160px_160px_160px_160px_160px_80px_90px] items-center gap-2 border-b border-[var(--line)] bg-[var(--sand-deep)] px-4 py-3 text-xs font-semibold text-[var(--ink-soft)]">
                <span>상품</span>
                <span>견적금액</span>
                <span>할인금액</span>
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
                  promotions={discountLoadError ? [] : promotions}
                  isSaving={saving === `${rule.service_type}:${rule.product_key}`}
                  onSave={(price, deposit, active) => saveRule(rule, price, deposit, active)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">이벤트 할인</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
              현재 {serviceLabel(tab)}에 자동 적용할 프로모션을 이 화면에서 바로 등록할 수 있습니다.
              여러 이벤트가 동시에 조건을 만족하면 고객에게 가장 큰 할인 1개가 자동 적용됩니다.
            </p>
          </div>
          <Link
            href="/admin/discounts"
            className="rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--navy)]"
          >
            쿠폰·상세 할인 관리
          </Link>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          <label className="text-xs text-[var(--ink-soft)]">
            이벤트 이름
            <input
              value={eventForm.name}
              onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs text-[var(--ink-soft)]">
            적용 상품
            <select
              value={eventForm.productKey}
              onChange={(e) => setEventForm({ ...eventForm, productKey: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            >
              <option value="">{serviceLabel(tab)} 전체</option>
              {tabRules.map((rule) => (
                <option key={rule.id} value={rule.product_key ?? ""}>
                  {productLabel(rule)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-[var(--ink-soft)]">
            할인 방식
            <select
              value={eventForm.discountType}
              onChange={(e) =>
                setEventForm({
                  ...eventForm,
                  discountType: e.target.value as "fixed" | "percent",
                })
              }
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            >
              <option value="fixed">정액 할인 (원)</option>
              <option value="percent">정률 할인 (%)</option>
            </select>
          </label>

          <label className="text-xs text-[var(--ink-soft)]">
            할인값
            <input
              type="number"
              min={0}
              value={eventForm.discountValue}
              onChange={(e) => setEventForm({ ...eventForm, discountValue: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs text-[var(--ink-soft)]">
            시작일시 (선택)
            <input
              type="datetime-local"
              value={eventForm.startsAt}
              onChange={(e) => setEventForm({ ...eventForm, startsAt: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs text-[var(--ink-soft)]">
            종료일시 (선택)
            <input
              type="datetime-local"
              value={eventForm.endsAt}
              onChange={(e) => setEventForm({ ...eventForm, endsAt: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs text-[var(--ink-soft)]">
            최소 결제금액
            <input
              type="number"
              min={0}
              value={eventForm.minAmount}
              onChange={(e) => setEventForm({ ...eventForm, minAmount: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            />
          </label>

          <label className="text-xs text-[var(--ink-soft)]">
            최대 할인금액 (선택)
            <input
              type="number"
              min={0}
              value={eventForm.maxDiscountAmount}
              onChange={(e) =>
                setEventForm({ ...eventForm, maxDiscountAmount: e.target.value })
              }
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={eventForm.isActive}
              onChange={(e) => setEventForm({ ...eventForm, isActive: e.target.checked })}
            />
            활성
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
            우선순위
            <input
              type="number"
              min={0}
              max={1000}
              value={eventForm.priority}
              onChange={(e) => setEventForm({ ...eventForm, priority: e.target.value })}
              className="w-20 rounded-lg border border-[var(--line)] px-2 py-1.5 text-sm"
            />
          </label>

          <button
            disabled={eventSaving || Boolean(discountLoadError)}
            onClick={saveEventPromotion}
            className="rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {eventSaving
              ? "저장 중..."
              : editingPromotionId
                ? "이벤트 할인 수정"
                : "이벤트 할인 등록"}
          </button>

          {editingPromotionId && (
            <button
              onClick={resetEventForm}
              className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--ink-soft)]"
            >
              수정 취소
            </button>
          )}
        </div>

        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <p className="mb-3 text-sm font-semibold">현재 적용 가능한 이벤트</p>
          {discountLoadError ? (
            <p className="rounded-xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
              이벤트 할인 정보를 불러오지 못해 현재 할인 목록을 표시할 수 없습니다.
            </p>
          ) : visiblePromotions.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft)]">등록된 이벤트 할인이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {visiblePromotions.map((promotion) => {
                const ownedByTab = promotion.service_type === tab;
                return (
                  <div
                    key={promotion.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {promotion.name}
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                            promotion.is_active === 1
                              ? "bg-[var(--mint-soft)] text-[var(--mint)]"
                              : "bg-[var(--sand-deep)] text-[var(--ink-soft)]"
                          }`}
                        >
                          {promotion.is_active === 1 ? "활성" : "중지"}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">
                        {promotion.service_type ? serviceLabel(promotion.service_type) : "전체 서비스"}
                        {" · "}
                        {promotion.product_key || "전체 상품"}
                        {" · "}
                        {promotion.discount_type === "percent"
                          ? `${promotion.discount_value}%`
                          : `${Number(promotion.discount_value).toLocaleString("ko-KR")}원`}
                        {promotion.starts_at ? ` · ${promotion.starts_at.slice(0, 16)}부터` : ""}
                        {promotion.ends_at ? ` · ${promotion.ends_at.slice(0, 16)}까지` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {ownedByTab ? (
                        <>
                          <button
                            onClick={() => editPromotion(promotion)}
                            className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => removePromotion(promotion.id)}
                            className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--rose)]"
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <Link
                          href="/admin/discounts"
                          className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium"
                        >
                          상세관리
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PriceRow({
  rule,
  promotions,
  isSaving,
  onSave,
}: {
  rule: PriceRule;
  promotions: PromotionRule[];
  isSaving: boolean;
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
  const promotion = currentPromotionFor(
    promotions,
    rule.service_type,
    rule.product_key,
    baseAmount
  );
  const discountAmount = promotion?.amount ?? 0;
  const totalPayment = Math.max(baseAmount - discountAmount, 0);
  const actualDeposit = Math.min(configuredDeposit, totalPayment);
  const balance = Math.max(totalPayment - actualDeposit, 0);
  const depositIsCapped = configuredDeposit > totalPayment;

  return (
    <div className="grid grid-cols-[130px_160px_160px_160px_160px_160px_80px_90px] items-center gap-2 border-b border-[var(--line)] px-4 py-3 last:border-b-0">
      <span className="text-sm font-semibold">{productLabel(rule)}</span>

      <label className="text-[11px] text-[var(--ink-soft)]">
        <span className="sr-only">견적금액</span>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)]"
        />
      </label>

      <div>
        <p className="text-sm font-semibold text-[var(--mint)]">
          {discountAmount > 0 ? `-${discountAmount.toLocaleString("ko-KR")}원` : "0원"}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-[var(--ink-soft)]" title={promotion?.name}>
          {promotion?.name ?? "적용 이벤트 없음"}
        </p>
      </div>

      <p className="text-sm font-bold text-[var(--ink)]">
        {totalPayment.toLocaleString("ko-KR")}원
      </p>

      <div>
        <input
          aria-label="선금 설정"
          type="number"
          min={0}
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
        />
        {depositIsCapped && (
          <p className="mt-0.5 text-[10px] text-[var(--rose)]">
            실결제 선금 {actualDeposit.toLocaleString("ko-KR")}원
          </p>
        )}
      </div>

      <p className="text-sm font-semibold text-[var(--ink)]">
        {balance.toLocaleString("ko-KR")}원
      </p>

      <label className="flex items-center justify-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
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
