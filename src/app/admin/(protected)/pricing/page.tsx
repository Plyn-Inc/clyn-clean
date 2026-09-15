"use client";

import { useEffect, useState } from "react";
import { SERVICE_TYPES, serviceLabel } from "@/lib/types";

interface PriceRule {
  id: number;
  service_type: string;
  product_key: string | null;
  note: string | null;
  base_price: number;
  deposit_amount: number;
  is_active: number;
}

type Msg = { type: "ok" | "err"; text: string } | null;

/**
 * 가격 관리.
 *
 * 서비스별 독립 가격 모델이다. 사이청소/거주청소는 입주청소의 배수가 아니라
 * 각자의 price_rules row를 가지며, 여기서 개별 수정한다.
 */
export default function AdminPricingPage() {
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [surcharge, setSurcharge] = useState("");
  const [tab, setTab] = useState<string>(SERVICE_TYPES[0]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    Promise.all([
      fetch("/api/admin/price-rules").then((r) => r.json()),
      fetch("/api/admin/settings").then((r) => r.json()),
    ])
      .then(([p, s]) => {
        setRules(p.rules ?? []);
        setSurcharge(String(s.settings?.holiday_surcharge ?? "30000"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const [p, s] = await Promise.all([
          fetch("/api/admin/price-rules").then((r) => r.json()),
          fetch("/api/admin/settings").then((r) => r.json()),
        ]);
        if (cancelled) return;
        setRules(p.rules ?? []);
        setSurcharge(String(s.settings?.holiday_surcharge ?? "30000"));
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

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
    const data = await res.json();
    setSaving(null);
    if (res.ok) { setMsg({ type: "ok", text: "저장했습니다." }); load(); }
    else setMsg({ type: "err", text: data.error || "저장 실패" });
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
    else setMsg({ type: "err", text: "저장 실패" });
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;

  const tabRules = rules.filter((r) => r.service_type === tab && r.product_key);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-xl font-bold">가격 관리</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
          서비스별로 가격이 독립 관리됩니다. 사이청소·거주청소는 입주청소 가격의 배수가 아니므로
          각 서비스에서 직접 수정해야 합니다. 가격 변경은 신규 예약에만 적용되며 기존 예약 금액은 바뀌지 않습니다.
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      {/* 휴일 가산금 */}
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
            저장
          </button>
        </div>
      </section>

      {/* 서비스 탭 */}
      <section>
        <div className="flex flex-wrap gap-2">
          {SERVICE_TYPES.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`rounded-full border px-4 py-2 text-xs font-medium ${
                tab === s
                  ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                  : "border-[var(--line)] text-[var(--ink-soft)]"
              }`}
            >
              {serviceLabel(s)}
            </button>
          ))}
        </div>

        {tabRules.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--ink-soft)]">
            {serviceLabel(tab)} 가격 항목이 없습니다.
          </p>
        ) : (
          <div className="mt-5 space-y-2">
            {tabRules.map((rule) => (
              <PriceRow
                key={rule.id}
                rule={rule}
                isSaving={saving === `${rule.service_type}:${rule.product_key}`}
                onSave={(p, d, a) => saveRule(rule, p, d, a)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PriceRow({
  rule, isSaving, onSave,
}: {
  rule: PriceRule;
  isSaving: boolean;
  onSave: (basePrice: number, deposit: number, active: boolean) => void;
}) {
  const [price, setPrice] = useState(String(rule.base_price));
  const [deposit, setDeposit] = useState(String(rule.deposit_amount ?? 0));
  const [active, setActive] = useState(rule.is_active === 1);

  const label = rule.product_key === "40평" ? "40평 이상" : rule.note || rule.product_key || "-";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <span className="w-28 shrink-0 text-sm font-medium">{label}</span>
      <label className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
        가격
        <input
          type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)}
          className="w-28 rounded-lg border border-[var(--line)] px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-[var(--ink-soft)]">
        예약금
        <input
          type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)}
          className="w-28 rounded-lg border border-[var(--line)] px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        활성
      </label>
      <button
        disabled={isSaving}
        onClick={() => onSave(Number(price) || 0, Number(deposit) || 0, active)}
        className="ml-auto rounded-lg bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {isSaving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}
