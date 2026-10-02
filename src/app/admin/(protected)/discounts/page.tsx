"use client";

import { useEffect, useState } from "react";

interface Promotion {
  id: number;
  name: string;
  is_active: number;
  discount_type: "fixed" | "percent";
  discount_value: number;
}

interface Coupon {
  id: number;
  code: string;
  name: string;
  is_active: number;
  discount_type: "fixed" | "percent";
  discount_value: number;
  total_usage_limit?: number | null;
  used_count?: number;
}

export default function AdminDiscountsPage() {
  const [tab, setTab] = useState<"promotion" | "coupon">("promotion");
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [active, setActive] = useState(true);

  const [couponCode, setCouponCode] = useState("");
  const [couponName, setCouponName] = useState("");
  const [couponAmount, setCouponAmount] = useState("");
  const [couponActive, setCouponActive] = useState(true);
  const [couponEditingId, setCouponEditingId] = useState<number | null>(null);

  async function loadPromotions() {
    const res = await fetch("/api/admin/discounts?kind=promotion", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "할인 목록을 불러오지 못했습니다.");
    setPromotions(data.promotions ?? []);
  }

  async function loadCoupons() {
    const res = await fetch("/api/admin/discounts?kind=coupon", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "쿠폰 목록을 불러오지 못했습니다.");
    setCoupons(data.coupons ?? []);
  }

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      await Promise.all([loadPromotions(), loadCoupons()]);
    } catch (error) {
      setMsg({
        type: "err",
        text: error instanceof Error ? error.message : "할인 정보를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetPromotion() {
    setEditingId(null);
    setName("");
    setAmount("");
    setActive(true);
  }

  function editPromotion(item: Promotion) {
    setEditingId(item.id);
    setName(item.name);
    setAmount(String(item.discount_value));
    setActive(item.is_active === 1);
  }

  async function savePromotion() {
    const value = Number(amount);
    if (!name.trim()) return setMsg({ type: "err", text: "할인 이름을 입력해주세요." });
    if (!Number.isFinite(value) || value <= 0) {
      return setMsg({ type: "err", text: "할인금액을 입력해주세요." });
    }

    const res = await fetch("/api/admin/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "promotion",
        id: editingId ?? undefined,
        name: name.trim(),
        isActive: active,
        discountType: "fixed",
        discountValue: Math.round(value),
        startsAt: null,
        endsAt: null,
        serviceType: null,
        productKey: null,
        minAmount: 0,
        maxDiscountAmount: null,
        priority: 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ type: "err", text: data.error || "저장에 실패했습니다." });

    setMsg({ type: "ok", text: editingId ? "할인을 수정했습니다." : "할인을 등록했습니다." });
    resetPromotion();
    await loadPromotions();
  }

  async function removePromotion(id: number) {
    if (!confirm("이 할인 항목을 삭제할까요? 가격설정의 연결도 함께 해제됩니다.")) return;
    const res = await fetch(`/api/admin/discounts?kind=promotion&id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ type: "err", text: data.error || "삭제에 실패했습니다." });
    setMsg({ type: "ok", text: "할인을 삭제했습니다." });
    if (editingId === id) resetPromotion();
    await loadPromotions();
  }

  function resetCoupon() {
    setCouponEditingId(null);
    setCouponCode("");
    setCouponName("");
    setCouponAmount("");
    setCouponActive(true);
  }

  async function saveCoupon() {
    const value = Number(couponAmount);
    if (!couponCode.trim() || !couponName.trim()) {
      return setMsg({ type: "err", text: "쿠폰 코드와 이름을 입력해주세요." });
    }
    if (!Number.isFinite(value) || value <= 0) {
      return setMsg({ type: "err", text: "쿠폰 할인금액을 입력해주세요." });
    }

    const res = await fetch("/api/admin/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "coupon",
        id: couponEditingId ?? undefined,
        code: couponCode.trim().toUpperCase(),
        name: couponName.trim(),
        isActive: couponActive,
        discountType: "fixed",
        discountValue: Math.round(value),
        startsAt: null,
        endsAt: null,
        serviceType: null,
        productKey: null,
        minAmount: 0,
        maxDiscountAmount: null,
        totalUsageLimit: null,
        perPhoneLimit: null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ type: "err", text: data.error || "쿠폰 저장에 실패했습니다." });

    setMsg({ type: "ok", text: couponEditingId ? "쿠폰을 수정했습니다." : "쿠폰을 등록했습니다." });
    resetCoupon();
    await loadCoupons();
  }

  async function removeCoupon(id: number) {
    if (!confirm("쿠폰을 삭제할까요?")) return;
    const res = await fetch(`/api/admin/discounts?kind=coupon&id=${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg({ type: "err", text: data.error || "쿠폰 삭제에 실패했습니다." });
    setMsg({ type: "ok", text: "쿠폰을 삭제했습니다." });
    if (couponEditingId === id) resetCoupon();
    await loadCoupons();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold">할인 관리</h1>
        <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
          할인 목록에서는 이름과 할인금액만 간단하게 만듭니다. 실제 적용 상품은 가격설정의
          <b className="mx-1 text-[var(--navy)]">할인 선택</b>
          버튼에서 여러 개를 선택합니다.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("promotion")}
          className={`rounded-full border px-4 py-2 text-xs font-medium ${
            tab === "promotion"
              ? "border-[var(--navy)] bg-[var(--navy)] text-white"
              : "border-[var(--line)] text-[var(--ink-soft)]"
          }`}
        >
          할인 목록
        </button>
        <button
          onClick={() => setTab("coupon")}
          className={`rounded-full border px-4 py-2 text-xs font-medium ${
            tab === "coupon"
              ? "border-[var(--navy)] bg-[var(--navy)] text-white"
              : "border-[var(--line)] text-[var(--ink-soft)]"
          }`}
        >
          쿠폰
        </button>
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

      {tab === "promotion" ? (
        <>
          <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="text-sm font-semibold">{editingId ? "할인 수정" : "할인 추가"}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px_auto]">
              <label className="text-xs text-[var(--ink-soft)]">
                할인 이름
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 오픈기념 할인"
                  className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
                />
              </label>
              <label className="text-xs text-[var(--ink-soft)]">
                할인금액
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="40000"
                    className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
                  />
                  <span>원</span>
                </div>
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                활성
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={savePromotion}
                className="rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white"
              >
                {editingId ? "수정 저장" : "할인 등록"}
              </button>
              {editingId && (
                <button
                  onClick={resetPromotion}
                  className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm"
                >
                  취소
                </button>
              )}
            </div>
          </section>

          <section>
            <p className="mb-3 text-sm font-semibold">등록된 할인 ({promotions.length})</p>
            {loading ? (
              <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>
            ) : promotions.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">등록된 할인이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {promotions.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {item.name}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                          item.is_active === 1
                            ? "bg-[var(--mint-soft)] text-[var(--mint)]"
                            : "bg-[var(--sand-deep)] text-[var(--ink-soft)]"
                        }`}>
                          {item.is_active === 1 ? "활성" : "중지"}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-[var(--mint)]">
                        {item.discount_type === "percent"
                          ? `${item.discount_value}% 할인`
                          : `${item.discount_value.toLocaleString("ko-KR")}원 할인`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => editPromotion(item)}
                        className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => removePromotion(item.id)}
                        className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--rose)]"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="text-sm font-semibold">{couponEditingId ? "쿠폰 수정" : "쿠폰 추가"}</p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              쿠폰은 고객이 직접 코드를 입력할 때 별도로 적용됩니다.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--ink-soft)]">
                쿠폰 코드
                <input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="WELCOME"
                  className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm uppercase"
                />
              </label>
              <label className="text-xs text-[var(--ink-soft)]">
                쿠폰 이름
                <input
                  value={couponName}
                  onChange={(e) => setCouponName(e.target.value)}
                  placeholder="예: 첫 예약 쿠폰"
                  className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
                />
              </label>
              <label className="text-xs text-[var(--ink-soft)]">
                할인금액
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={couponAmount}
                    onChange={(e) => setCouponAmount(e.target.value)}
                    className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
                  />
                  <span>원</span>
                </div>
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={couponActive}
                  onChange={(e) => setCouponActive(e.target.checked)}
                />
                활성
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={saveCoupon}
                className="rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white"
              >
                {couponEditingId ? "쿠폰 수정 저장" : "쿠폰 등록"}
              </button>
              {couponEditingId && (
                <button
                  onClick={resetCoupon}
                  className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm"
                >
                  취소
                </button>
              )}
            </div>
          </section>

          <section>
            <p className="mb-3 text-sm font-semibold">등록된 쿠폰 ({coupons.length})</p>
            {coupons.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">등록된 쿠폰이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {coupons.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        <span className="mr-2 font-mono">{item.code}</span>
                        {item.name}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">
                        {item.discount_type === "percent"
                          ? `${item.discount_value}%`
                          : `${item.discount_value.toLocaleString("ko-KR")}원`}
                        {" · "}
                        사용 {item.used_count ?? 0}회
                        {" · "}
                        {item.is_active === 1 ? "활성" : "중지"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setCouponEditingId(item.id);
                          setCouponCode(item.code);
                          setCouponName(item.name);
                          setCouponAmount(String(item.discount_value));
                          setCouponActive(item.is_active === 1);
                        }}
                        className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => removeCoupon(item.id)}
                        className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--rose)]"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
