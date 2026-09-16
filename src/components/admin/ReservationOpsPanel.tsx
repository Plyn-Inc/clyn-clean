"use client";

import { useEffect, useState } from "react";

interface Adjustment {
  id: number; admin_name: string | null; discount_type: string; discount_value: number;
  calculated_amount: number; reason: string; previous_final_amount: number;
  new_final_amount: number; created_at: string;
}
interface OutboxRow {
  id: number; event_type: string; status: string; preferred_channel: string;
  actual_channel: string | null; attempts: number; created_at: string;
  updated_at: string; provider_message_id: string | null;
  fallback_message_id: string | null; last_error_message: string | null;
}

const EVENT_LABEL: Record<string, string> = {
  reservation_received: "예약 접수",
  deposit_confirmed: "입금 확인",
  reservation_confirmed: "예약 확정",
};

/**
 * 발송 상태 문구.
 *
 * provider가 요청을 접수한 것과 실제 수신을 구분한다.
 * 접수만 된 상태를 "전송 완료"라고 표시하지 않는다.
 */
const STATUS_LABEL: Record<string, string> = {
  pending: "발송 대기",
  processing: "처리 중",
  submitted: "발송 요청됨",
  awaiting_delivery: "전송 결과 확인 중",
  delivered: "카카오 전송 완료",
  kakao_failed: "카카오 실패",
  fallback_submitted: "문자 대체 발송 요청됨",
  fallback_delivered: "문자 전송 완료",
  retry_pending: "재시도 대기",
  failed: "최종 실패",
};

/**
 * 재시도 버튼을 보여줄 상태 (allowlist).
 *
 * 서버 API(RETRYABLE_STATUSES)와 같은 정책이다.
 * provider에 이미 접수된 상태(submitted / awaiting_delivery / fallback_submitted)는
 * 재시도하면 실제 중복 발송이 되므로 버튼을 노출하지 않는다.
 *
 * UI 숨김은 편의일 뿐이고, 최종 방어선은 서버 API다.
 */
const RETRYABLE = new Set(["failed", "retry_pending"]);

const won = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString("ko-KR")}원`;

export default function ReservationOpsPanel({
  reservationId,
  finalAmount,
  depositAmount,
}: {
  reservationId: number;
  finalAmount: number;
  depositAmount: number;
}) {
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [notifications, setNotifications] = useState<OutboxRow[]>([]);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const d = await fetch(`/api/admin/reservations/${reservationId}/detail`).then((r) => r.json());
      setAdjustments(d.adjustments ?? []);
      setNotifications(d.notifications ?? []);
    } catch { /* 부가정보 조회 실패가 예약 상세를 막지 않는다 */ }
  }

  useEffect(() => {
    void Promise.resolve().then(() => { void load(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationId]);

  // 미리보기 — 실제 금액은 서버가 확정한다
  const value = Number(discountValue) || 0;
  const preview = discountType === "percent" ? Math.floor((finalAmount * value) / 100) : value;
  const nextFinal = Math.max(finalAmount - preview, 0);
  const nextBalance = Math.max(nextFinal - depositAmount, 0);

  async function applyDiscount() {
    setSaving(true);
    setMsg(null);
    const res = await fetch(`/api/admin/reservations/${reservationId}/discount`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discountType, discountValue: value, reason }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setMsg({ type: "ok", text: "할인을 적용했습니다. 새로고침하면 금액이 갱신됩니다." });
      setDiscountValue(""); setReason("");
      void load();
    } else {
      setMsg({ type: "err", text: data.error ?? "할인 적용에 실패했습니다." });
    }
  }

  async function retry(id: number) {
    const res = await fetch("/api/admin/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { setMsg({ type: "ok", text: "재시도 대기로 변경했습니다." }); void load(); }
    else setMsg({ type: "err", text: data.error ?? "재시도에 실패했습니다." });
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      {/* 관리자 수동 할인 */}
      <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-sm font-semibold">관리자 할인</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
          할인 사유는 필수입니다. 이미 입금된 금액보다 낮아지는 할인은 적용되지 않습니다.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-[var(--ink-soft)]">
            방식
            <select value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "fixed" | "percent")}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
              <option value="fixed">정액 (원)</option>
              <option value="percent">정률 (%)</option>
            </select>
          </label>
          <label className="text-xs text-[var(--ink-soft)]">
            할인값
            <input type="number" min={0} value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-[var(--ink-soft)] sm:col-span-3">
            할인 사유 (필수)
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="예: 재방문 고객 할인"
              className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
          </label>
        </div>

        {value > 0 && (
          <dl className="mt-3 space-y-1 rounded-lg bg-[var(--sand-deep)] p-3 text-xs">
            <Line label="현재 최종금액" value={won(finalAmount)} />
            <Line label="적용 할인금액" value={`-${won(preview)}`} />
            <Line label="변경 후 최종금액" value={won(nextFinal)} strong />
            <Line label="변경 후 잔금" value={won(nextBalance)} />
          </dl>
        )}

        <button
          disabled={saving || value <= 0 || !reason.trim()}
          onClick={applyDiscount}
          className="mt-3 rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "적용 중..." : "할인 적용"}
        </button>
      </section>

      {/* 할인 audit */}
      <section>
        <p className="mb-2 text-sm font-semibold">할인 변경 이력 ({adjustments.length})</p>
        {adjustments.length === 0 ? (
          <p className="text-xs text-[var(--ink-soft)]">관리자 할인 이력이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {adjustments.map((a) => (
              <div key={a.id} className="rounded-xl border border-[var(--line)] bg-white p-3 text-xs">
                <p className="font-medium text-[var(--ink)]">
                  {a.discount_type === "percent" ? `${a.discount_value}%` : won(a.discount_value)}
                  {" → "}실제 -{won(a.calculated_amount)}
                </p>
                <p className="mt-1 text-[var(--ink-soft)]">
                  {won(a.previous_final_amount)} → {won(a.new_final_amount)}
                </p>
                <p className="mt-1 text-[var(--ink-soft)]">
                  {a.created_at.slice(0, 16).replace("T", " ")} · {a.admin_name ?? "관리자"} · {a.reason}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 메시지 발송이력 */}
      <section>
        <p className="mb-2 text-sm font-semibold">메시지 발송 이력 ({notifications.length})</p>
        {notifications.length === 0 ? (
          <p className="text-xs text-[var(--ink-soft)]">발송 이력이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className="rounded-xl border border-[var(--line)] bg-white p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-[var(--ink)]">
                    {EVENT_LABEL[n.event_type] ?? n.event_type}
                    <span className="ml-2 rounded-full bg-[var(--sand-deep)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">
                      {STATUS_LABEL[n.status] ?? n.status}
                    </span>
                  </p>
                  {RETRYABLE.has(n.status) && (
                    <button onClick={() => retry(n.id)}
                      className="shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-medium">
                      재시도
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[var(--ink-soft)]">
                  채널 {n.actual_channel ?? n.preferred_channel}
                  {n.fallback_message_id ? " · 문자 대체" : ""}
                  {` · 시도 ${n.attempts}회`}
                </p>
                <p className="mt-0.5 text-[var(--ink-soft)]">
                  생성 {n.created_at.slice(0, 16).replace("T", " ")} · 최근 {n.updated_at.slice(0, 16).replace("T", " ")}
                </p>
                {n.provider_message_id && (
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--ink-soft)]">{n.provider_message_id}</p>
                )}
                {n.last_error_message && (
                  <p className="mt-1 text-[var(--rose)]">{n.last_error_message}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--ink-soft)]">{label}</dt>
      <dd className={strong ? "font-bold text-[var(--ink)]" : "text-[var(--ink)]"}>{value}</dd>
    </div>
  );
}
