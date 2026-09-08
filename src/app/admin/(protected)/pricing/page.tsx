"use client";

import { useEffect, useState } from "react";
import { HOUSE_TYPES_FIXED, HOUSE_SIZES_APARTMENT, EXTRA_OPTIONS } from "@/lib/types";

// 고정 상품 키 목록 (inputs.ts와 동일한 source of truth)
const FIXED_HOUSE_KEYS = [
  ...HOUSE_TYPES_FIXED,
  ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
];

interface PriceRule {
  id: number;
  service_type: string;
  note: string | null;
  base_price: number;
  is_active: number;
}

interface OptionPrice {
  id: number;
  option_key: string;
  option_label: string;
  price: number;
  is_active: number;
}

type Msg = { type: "ok" | "err"; text: string } | null;

export default function AdminPricingPage() {
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [options, setOptions] = useState<OptionPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState<string | null>(null); // 저장 중인 key

  function load() {
    setLoading(true);
    fetch("/api/admin/price-rules")
      .then((r) => r.json())
      .then((data) => {
        setRules(data.rules || []);
        setOptions(data.options || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/price-rules")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setRules(data.rules || []);
        setOptions(data.options || []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function saveRule(note: string, price: number, isActive: boolean) {
    const existing = rules.find((r) => r.service_type === "입주청소" && r.note === note);
    setSaving(note);
    setMsg(null);
    const body = {
      type: "rule",
      id: existing?.id,
      serviceType: "입주청소",
      areaMin: 0,
      areaMax: null,
      basePrice: price,
      isActive,
      note,
    };
    const res = await fetch("/api/admin/price-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(null);
    if (res.ok) { setMsg({ type: "ok", text: `${note} 저장 완료` }); load(); }
    else setMsg({ type: "err", text: data.error || "저장 실패" });
  }

  async function saveOption(key: string, price: number, isActive: boolean) {
    setSaving(key);
    setMsg(null);
    const res = await fetch("/api/admin/price-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "option", optionKey: key, price, isActive }),
    });
    const data = await res.json();
    setSaving(null);
    if (res.ok) { setMsg({ type: "ok", text: "옵션 저장 완료" }); load(); }
    else setMsg({ type: "err", text: data.error || "저장 실패" });
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="font-display text-xl font-bold">가격 설정</h1>
        <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
          입주청소 기준가격을 수정하면 사이청소(×1.5)·거주청소(×1.1)에 자동 반영됩니다.
          가격 변경은 새 예약에만 영향을 주며 기존 예약 Snapshot은 변경되지 않습니다.
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      {/* 입주청소 기준가격 */}
      <section>
        <h2 className="mb-4 font-display text-base font-bold">입주청소 기준가격</h2>
        <p className="mb-4 text-xs text-[var(--ink-soft)]">
          사이청소 = 기준가 × 1.5　　거주청소 = 기준가 × 1.1
        </p>
        <div className="space-y-2">
          {FIXED_HOUSE_KEYS.map((key) => {
            const rule = rules.find((r) => r.service_type === "입주청소" && r.note === key);
            return (
              <HouseRow
                key={key}
                label={key}
                defaultPrice={rule?.base_price ?? 0}
                defaultActive={rule ? rule.is_active === 1 : true}
                isSaving={saving === key}
                onSave={(price, active) => saveRule(key, price, active)}
              />
            );
          })}
        </div>
      </section>

      {/* 추가 옵션 */}
      <section>
        <h2 className="mb-4 font-display text-base font-bold">추가 서비스 옵션</h2>
        <p className="mb-4 text-xs text-[var(--ink-soft)]">
          0원 = 상담 후 확정. 고객 견적화면에서 &quot;작업 전 금액 안내&quot;로 표시됩니다.
        </p>
        <div className="space-y-2">
          {EXTRA_OPTIONS.map((opt) => {
            const row = options.find((o) => o.option_key === opt.key);
            return (
              <OptionRow
                key={opt.key}
                optKey={opt.key}
                label={opt.label}
                defaultPrice={row?.price ?? 0}
                defaultActive={row ? row.is_active === 1 : true}
                isSaving={saving === opt.key}
                onSave={(price, active) => saveOption(opt.key, price, active)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function HouseRow({
  label, defaultPrice, defaultActive, isSaving, onSave,
}: {
  label: string;
  defaultPrice: number;
  defaultActive: boolean;
  isSaving: boolean;
  onSave: (price: number, active: boolean) => void;
}) {
  const [price, setPrice] = useState(String(defaultPrice));
  const [active, setActive] = useState(defaultActive);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <span className="w-24 shrink-0 text-sm font-medium">{label}</span>
      <input
        type="number"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="w-32 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm focus:border-[var(--mint)] focus:outline-none"
        placeholder="0"
        min={0}
      />
      <span className="text-xs text-[var(--ink-soft)]">원</span>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        활성
      </label>
      <button
        disabled={isSaving}
        onClick={() => onSave(Number(price) || 0, active)}
        className="ml-auto rounded-lg bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:opacity-90"
      >
        {isSaving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}

function OptionRow({
  label, defaultPrice, defaultActive, isSaving, onSave,
}: {
  optKey: string;
  label: string;
  defaultPrice: number;
  defaultActive: boolean;
  isSaving: boolean;
  onSave: (price: number, active: boolean) => void;
}) {
  const [price, setPrice] = useState(String(defaultPrice));
  const [active, setActive] = useState(defaultActive);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3">
      <span className="flex-1 text-sm">{label}</span>
      <input
        type="number"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="w-28 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm focus:border-[var(--mint)] focus:outline-none"
        placeholder="0 = 상담후확정"
        min={0}
      />
      <span className="text-xs text-[var(--ink-soft)]">원</span>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        활성
      </label>
      <button
        disabled={isSaving}
        onClick={() => onSave(Number(price) || 0, active)}
        className="rounded-lg bg-[var(--navy)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:opacity-90"
      >
        {isSaving ? "..." : "저장"}
      </button>
    </div>
  );
}
