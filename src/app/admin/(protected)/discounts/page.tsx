"use client";

import { useEffect, useState } from "react";

interface Rule {
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
  code?: string;
  total_usage_limit?: number | null;
  used_count?: number;
}

const EMPTY = {
  name: "", isActive: true, discountType: "fixed" as "fixed" | "percent",
  discountValue: 0, startsAt: "", endsAt: "", serviceType: "", productKey: "",
  minAmount: 0, maxDiscountAmount: "", priority: 0, code: "", totalUsageLimit: "",
};

/**
 * 할인 관리 — 프로모션 / 쿠폰.
 *
 * 프로모션·쿠폰을 수정하거나 중지해도 이미 접수된 예약의 금액은 바뀌지 않습니다.
 * (예약 생성 시점 금액이 예약에 따로 저장됩니다)
 */
export default function AdminDiscountsPage() {
  const [tab, setTab] = useState<"promotion" | "coupon">("promotion");
  const [promotions, setPromotions] = useState<Rule[]>([]);
  const [coupons, setCoupons] = useState<Rule[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load() {
    try {
      const d = await fetch("/api/admin/discounts").then((r) => r.json());
      setPromotions(d.promotions ?? []);
      setCoupons(d.coupons ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => { void load(); });
  }, []);

  function reset() {
    setEditingId(null);
    setForm({ ...EMPTY });
  }

  function edit(r: Rule) {
    setEditingId(r.id);
    setForm({
      name: r.name, isActive: r.is_active === 1,
      discountType: r.discount_type, discountValue: r.discount_value,
      startsAt: r.starts_at?.slice(0, 16) ?? "", endsAt: r.ends_at?.slice(0, 16) ?? "",
      serviceType: r.service_type ?? "", productKey: r.product_key ?? "",
      minAmount: r.min_amount, maxDiscountAmount: r.max_discount_amount?.toString() ?? "",
      priority: r.priority ?? 0, code: r.code ?? "",
      totalUsageLimit: r.total_usage_limit?.toString() ?? "",
    });
  }

  async function save() {
    setMsg(null);
    const payload: Record<string, unknown> = {
      kind: tab, id: editingId ?? undefined,
      name: form.name, isActive: form.isActive,
      discountType: form.discountType, discountValue: Number(form.discountValue) || 0,
      startsAt: form.startsAt || null, endsAt: form.endsAt || null,
      serviceType: form.serviceType || null, productKey: form.productKey || null,
      minAmount: Number(form.minAmount) || 0,
      maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : null,
    };
    if (tab === "promotion") payload.priority = Number(form.priority) || 0;
    else {
      payload.code = form.code;
      payload.totalUsageLimit = form.totalUsageLimit ? Number(form.totalUsageLimit) : null;
    }

    const res = await fetch("/api/admin/discounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setMsg({ type: "ok", text: "저장했습니다." }); reset(); void load(); }
    else setMsg({ type: "err", text: data.error ?? "저장에 실패했습니다." });
  }

  async function remove(id: number) {
    if (!confirm("삭제할까요?")) return;
    const res = await fetch(`/api/admin/discounts?kind=${tab}&id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setMsg({ type: "ok", text: "삭제했습니다." }); void load(); }
    else setMsg({ type: "err", text: data.error ?? "삭제에 실패했습니다." });
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;
  const rows = tab === "promotion" ? promotions : coupons;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold">할인 관리</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
          자동 프로모션과 쿠폰은 함께 적용됩니다. 조건을 만족하는 프로모션이 여러 개면
          고객에게 가장 유리한 1개만 적용됩니다. 할인 내용을 바꿔도 이미 접수된 예약의
          금액은 변하지 않습니다.
        </p>
      </div>

      <div className="flex gap-2">
        {(["promotion", "coupon"] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); reset(); }}
            className={`rounded-full border px-4 py-2 text-xs font-medium ${
              tab === t ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"
            }`}>
            {t === "promotion" ? "자동 프로모션" : "쿠폰"}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-sm font-semibold">{editingId ? "수정" : "새로 만들기"}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {tab === "coupon" && (
            <Field label="쿠폰 코드" value={form.code}
              onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} placeholder="WELCOME" />
          )}
          <Field label="이름" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <label className="text-xs text-[var(--ink-soft)]">
            할인 방식
            <select value={form.discountType}
              onChange={(e) => setForm({ ...form, discountType: e.target.value as "fixed" | "percent" })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
              <option value="fixed">정액 (원)</option>
              <option value="percent">정률 (%)</option>
            </select>
          </label>
          <Field label="할인값" type="number" value={String(form.discountValue)}
            onChange={(v) => setForm({ ...form, discountValue: Number(v) || 0 })} />
          <Field label="시작 (KST)" type="datetime-local" value={form.startsAt}
            onChange={(v) => setForm({ ...form, startsAt: v })} />
          <Field label="종료 (KST)" type="datetime-local" value={form.endsAt}
            onChange={(v) => setForm({ ...form, endsAt: v })} />
          <Field label="적용 서비스 (비우면 전체)" value={form.serviceType}
            onChange={(v) => setForm({ ...form, serviceType: v })} placeholder="입주청소" />
          <Field label="적용 상품 (비우면 전체)" value={form.productKey}
            onChange={(v) => setForm({ ...form, productKey: v })} placeholder="24평" />
          <Field label="최소 결제금액" type="number" value={String(form.minAmount)}
            onChange={(v) => setForm({ ...form, minAmount: Number(v) || 0 })} />
          <Field label="최대 할인금액 (선택)" type="number" value={form.maxDiscountAmount}
            onChange={(v) => setForm({ ...form, maxDiscountAmount: v })} />
          {tab === "promotion" ? (
            <Field label="우선순위" type="number" value={String(form.priority)}
              onChange={(v) => setForm({ ...form, priority: Number(v) || 0 })} />
          ) : (
            <Field label="전체 사용 한도 (선택)" type="number" value={form.totalUsageLimit}
              onChange={(v) => setForm({ ...form, totalUsageLimit: v })} />
          )}
          <label className="flex items-end gap-1.5 text-sm">
            <input type="checkbox" checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            활성
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={!form.name.trim() || (tab === "coupon" && !form.code.trim())}
            onClick={save}
            className="rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {editingId ? "수정" : "등록"}
          </button>
          {editingId && (
            <button onClick={reset}
              className="rounded-lg border border-[var(--line)] px-5 py-2.5 text-sm font-semibold text-[var(--ink-soft)]">
              취소
            </button>
          )}
        </div>
      </section>

      <section>
        <p className="mb-3 text-sm font-semibold">
          {tab === "promotion" ? "프로모션" : "쿠폰"} ({rows.length})
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">등록된 항목이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] bg-white p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.code ? <span className="mr-1.5 font-mono">{r.code}</span> : null}
                    {r.name}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${r.is_active === 1 ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[var(--sand-deep)] text-[var(--ink-soft)]"}`}>
                      {r.is_active === 1 ? "활성" : "중지"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    {r.discount_type === "percent" ? `${r.discount_value}%` : `${r.discount_value.toLocaleString("ko-KR")}원`}
                    {r.max_discount_amount ? ` (최대 ${r.max_discount_amount.toLocaleString("ko-KR")}원)` : ""}
                    {r.min_amount > 0 ? ` · ${r.min_amount.toLocaleString("ko-KR")}원 이상` : ""}
                    {r.service_type ? ` · ${r.service_type}` : ""}
                    {r.product_key ? ` · ${r.product_key}` : ""}
                    {r.total_usage_limit != null ? ` · 사용 ${r.used_count ?? 0}/${r.total_usage_limit}` : ""}
                    {r.code && r.total_usage_limit == null ? ` · 사용 ${r.used_count ?? 0}회` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => edit(r)}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium">수정</button>
                  <button onClick={() => remove(r.id)}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--rose)]">삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="text-xs text-[var(--ink-soft)]">
      {label}
      <input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
    </label>
  );
}
