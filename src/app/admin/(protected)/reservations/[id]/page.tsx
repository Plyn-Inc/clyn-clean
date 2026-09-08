"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import {
  RESERVATION_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  OCCUPANCY_STATUS_LABEL,
  EXTRA_OPTIONS,
  PAYMENT_METHOD_LABEL,
} from "@/lib/types";
import type {
  Reservation,
  Payment,
  ConfirmationLog,
  ReservationStatus,
  OccupancyStatus,
} from "@/lib/types";

export default function AdminReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [logs, setLogs] = useState<ConfirmationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [memo, setMemo] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/admin/reservations/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setReservation(data.reservation);
        setPayment(data.payment);
        setLogs(data.logs || []);
        setMemo(data.reservation?.admin_memo || "");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line

  async function callApi(url: string, body?: object) {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error || "처리 중 오류가 발생했습니다." });
      } else {
        setMessage({ type: "ok", text: data.message || "처리가 완료되었습니다." });
        load();
      }
    } catch {
      setMessage({ type: "err", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;
  if (!reservation) return <p className="text-sm text-[var(--ink-soft)]">예약을 찾을 수 없습니다.</p>;

  let extraOptions: string[] = [];
  try { extraOptions = JSON.parse(reservation.extra_options || "[]"); } catch { extraOptions = []; }

  // 입금기한 초과 여부 판단
  const isOverdue = payment?.payment_due_date
    ? new Date(payment.payment_due_date) < new Date() && payment.payment_status === "pending"
    : false;

  return (
    <div>
      <Link href="/admin/reservations" className="text-sm font-medium text-[var(--mint)] hover:underline">← 예약 목록</Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-bold">{reservation.reservation_code}</h1>
        <div className="flex flex-wrap gap-2">
          <Pill text={RESERVATION_STATUS_LABEL[reservation.reservation_status]} />
          {payment && <Pill text={PAYMENT_STATUS_LABEL[payment.payment_status]} muted />}
          {isOverdue && <Pill text="입금기한 초과" warning />}
        </div>
      </div>

      {message && (
        <div className={`mt-4 rounded-lg px-4 py-3 text-sm ${message.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {message.text}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Section title="고객 정보">
            <Field label="예약자명" value={reservation.customer_name} />
            <Field label="연락처" value={reservation.customer_phone} />
            <Field label="이메일" value={reservation.customer_email || "-"} />
          </Section>

          <Section title="청소 정보">
            <Field label="청소 종류" value={reservation.service_type} />
            <Field label="주택유형" value={reservation.house_type_key || "-"} />
            <Field label="지역" value={reservation.region} />
            <Field label="주소" value={reservation.address} />
            <Field label="실제 평수" value={reservation.area_pyeong ? `${reservation.area_pyeong}평` : "-"} />
            <Field label="집 구조" value={reservation.house_structure || "-"} />
            <Field label="입주 상태" value={reservation.occupancy_status ? OCCUPANCY_STATUS_LABEL[reservation.occupancy_status as OccupancyStatus] : "-"} />
            <Field label="희망 날짜" value={reservation.desired_date || "미정"} />
            <Field
              label="예약 시간대"
              value={
                reservation.time_slot === "morning"
                  ? "오전"
                  : reservation.time_slot === "afternoon"
                    ? "오후"
                    : reservation.time_slot === "all_day"
                      ? "시간 미지정 (구형 예약)"
                      : reservation.time_slot || "-"
              }
            />
            <Field label="진입 경로" value={reservation.entry_route === "calendar" ? "캘린더 클릭" : "바로 예약하기"} />
            <Field
              label="추가사항"
              value={extraOptions.length > 0
                ? extraOptions.map((k) => EXTRA_OPTIONS.find((o) => o.key === k)?.label || k).join(", ")
                : "없음"}
            />
            {/* extra_notes에서 [내부메타] JSON 파싱 */}
            <MetaInfoPanel notes={reservation.extra_notes} />
            <Field label="기타 요청" value={reservation.extra_notes?.replace(/\n?\[내부메타\][\s\S]*$/, "").trim() || "-"} />
            <Field label="현장 사진" value={reservation.has_site_photos ? "있음" : "없음"} />
          </Section>

          <Section title="결제/입금 정보">
            <Field label="결제 수단" value={payment ? PAYMENT_METHOD_LABEL[payment.payment_method] : "-"} />
            <Field label="예약금" value={payment ? `${payment.amount.toLocaleString("ko-KR")}원` : "-"} />
            <Field label="입금자명" value={payment?.depositor_name || "-"} />
            <Field label="입금 기한" value={payment?.payment_due_date ? new Date(payment.payment_due_date).toLocaleString("ko-KR") : "-"} />
            <Field label="입금 확인 일시" value={payment?.confirmed_at ? new Date(payment.confirmed_at).toLocaleString("ko-KR") : "-"} />
            {/* 자동견적 금액 */}
            {reservation.base_price_snapshot != null && (
              <Field label="자동견적 기준가" value={`${reservation.base_price_snapshot.toLocaleString("ko-KR")}원`} />
            )}
            {reservation.price_multiplier !== 1 && (
              <Field label="가격 승수" value={`× ${reservation.price_multiplier} (${reservation.service_type})`} />
            )}
            {reservation.estimated_total_snapshot != null && (
              <Field
                label={reservation.price_confirmed_snapshot === 0 ? "자동견적 (미확정 시작가)" : "자동견적 합계"}
                value={`${reservation.estimated_total_snapshot.toLocaleString("ko-KR")}원${reservation.price_confirmed_snapshot === 0 ? "~" : ""}`}
              />
            )}
            {reservation.final_confirmed_total != null && (
              <Field label="최종 확정금액" value={`${reservation.final_confirmed_total.toLocaleString("ko-KR")}원`} bold />
            )}
            {reservation.price_confirmed_snapshot === 0 && reservation.final_confirmed_total == null && (
              <div className="col-span-2 rounded-lg bg-[#FBE9D3] px-3 py-2 text-xs text-[var(--amber)]">
                ⚠ 이 예약은 40평 이상 등 미확정 견적입니다. 관리자가 고객과 협의 후 최종 견적금액을 아래에 입력해주세요.
              </div>
            )}
            <Field
              label="즉시예약 할인"
              value={reservation.instant_discount_eligible
                ? reservation.instant_discount_applied ? "자격 있음 · 적용됨" : "자격 있음 · 입금확인 후 적용"
                : "자격 없음"}
            />
          </Section>

          <Section title="처리 로그">
            {logs.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">기록이 없습니다.</p>
            ) : (
              <ul className="col-span-2 space-y-3">
                {logs.map((log) => (
                  <li key={log.id} className="rounded-lg border border-[var(--line)] bg-[var(--sand-deep)] px-4 py-3 text-sm">
                    <p className="font-medium text-[var(--ink)]">{log.detail || log.action}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                      처리자: {log.admin_name} · {new Date(log.created_at).toLocaleString("ko-KR")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          {/* 시간대 변경 */}
          <SlotChangePanel
            reservationId={Number(id)}
            currentDate={reservation.desired_date ?? ""}
            currentSlot={reservation.time_slot}
            onDone={load}
          />

          {/* 최종 견적금액 입력 (40평 이상 또는 상담 후 확정 항목이 있는 경우) */}
          <FinalTotalPanel
            reservationId={Number(id)}
            priceConfirmed={reservation.price_confirmed_snapshot}
            currentTotal={reservation.final_confirmed_total}
            estimatedTotal={reservation.estimated_total_snapshot}
            onDone={load}
          />

          {/* 선입금 확인 처리 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="text-sm font-semibold">선입금 확인 처리</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-soft)]">
              입금자명과 금액을 확인한 뒤 처리해주세요. 선입금 확인 후 예약확정은 별도로 진행합니다.
            </p>
            <button
              disabled={actionLoading || payment?.payment_status === "confirmed"}
              onClick={() => callApi(`/api/admin/reservations/${id}/confirm-payment`, { memo: "수기 선입금 확인 처리" })}
              className="mt-4 w-full rounded-lg bg-[var(--mint)] py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {payment?.payment_status === "confirmed" ? "✓ 선입금 확인 완료됨" : "선입금 확인 완료 처리"}
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button disabled={actionLoading} onClick={() => callApi(`/api/admin/reservations/${id}/payment-status`, { status: "unconfirmed" })}
                className="rounded-lg border border-[var(--line)] py-2 text-xs font-medium hover:bg-[var(--sand-deep)]">
                입금 미확인
              </button>
              <button disabled={actionLoading} onClick={() => callApi(`/api/admin/reservations/${id}/payment-status`, { status: "refund_required" })}
                className="rounded-lg border border-[var(--line)] py-2 text-xs font-medium hover:bg-[var(--sand-deep)]">
                환불 필요
              </button>
            </div>
          </div>

          {/* 관리자 최종 예약확정 */}
          <div className={`rounded-2xl border p-5 ${
            reservation?.reservation_status === "confirmed"
              ? "border-[var(--navy)] bg-[var(--navy)]/5"
              : payment?.payment_status === "confirmed" && reservation?.reservation_status === "awaiting_admin_check"
                ? "border-[var(--amber)] bg-[#FBE9D3]"
                : "border-[var(--line)] bg-white opacity-60"
          }`}>
            <p className="text-sm font-semibold">관리자 최종 예약확정</p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-soft)]">
              {reservation?.reservation_status === "confirmed"
                ? "이미 예약이 확정된 상태입니다."
                : payment?.payment_status === "confirmed" && reservation?.reservation_status === "awaiting_admin_check"
                  ? "선입금이 확인됐습니다. 신청내용과 일정을 검토한 뒤 예약을 확정해주세요."
                  : "선입금 확인 완료 후 예약확정이 가능합니다."}
            </p>
            {reservation?.reservation_status !== "confirmed" && (
              <button
                disabled={
                  actionLoading ||
                  payment?.payment_status !== "confirmed" ||
                  reservation?.reservation_status !== "awaiting_admin_check"
                }
                onClick={() => callApi(`/api/admin/reservations/${id}/confirm-reservation`, { memo: "관리자 검토 후 최종 예약확정" })}
                className="mt-4 w-full rounded-lg bg-[var(--navy)] py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {payment?.payment_status !== "confirmed"
                  ? "선입금 확인 후 활성화"
                  : "예약 확정"}
              </button>
            )}
            {reservation?.reservation_status === "confirmed" && (
              <p className="mt-3 text-center text-sm font-bold text-[var(--navy)]">✅ 예약 확정 완료</p>
            )}
          </div>

          {/* 입금기한 초과 취소 (명세 3번 - 관리자 수동 실행) */}
          {isOverdue && (
            <div className="rounded-2xl border border-[var(--amber)] bg-[#FBE9D3] p-5">
              <p className="text-sm font-semibold text-[var(--amber)]">⚠ 입금기한 초과</p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--amber)]/80">
                입금 기한이 지났습니다. 확인 후 직접 취소 처리를 진행해주세요.
                취소 시 해당 날짜 잔여석이 자동으로 회복됩니다.
              </p>
              <button
                disabled={actionLoading}
                onClick={() => {
                  if (!confirm("이 예약을 취소 처리하시겠습니까? 취소 후 해당 날짜 잔여석이 회복됩니다.")) return;
                  callApi(`/api/admin/reservations/${id}/cancel-overdue`);
                }}
                className="mt-3 w-full rounded-lg border border-[var(--amber)] bg-white py-2.5 text-sm font-semibold text-[var(--amber)] transition hover:bg-[var(--amber)] hover:text-white disabled:opacity-50"
              >
                수동 취소 처리 (잔여석 회복)
              </button>
            </div>
          )}

          {/* 예약 상태 변경 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="text-sm font-semibold">예약 상태 변경</p>
            <div className="mt-3 space-y-1.5">
              {(Object.entries(RESERVATION_STATUS_LABEL) as [ReservationStatus, string][]).map(([key, label]) => (
                <button key={key}
                  disabled={actionLoading || reservation.reservation_status === key}
                  onClick={() => callApi(`/api/admin/reservations/${id}/status`, { status: key })}
                  className={`w-full rounded-lg border py-2 text-sm font-medium transition ${reservation.reservation_status === key ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] hover:bg-[var(--sand-deep)]"} disabled:cursor-not-allowed`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 관리자 메모 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="text-sm font-semibold">관리자 메모</p>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={4}
              className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm focus:border-[var(--mint)] focus:outline-none" />
            <button disabled={actionLoading}
              onClick={() => callApi(`/api/admin/reservations/${id}/memo`, { memo })}
              className="mt-2 w-full rounded-lg border border-[var(--line)] py-2 text-sm font-medium hover:bg-[var(--sand-deep)]">
              메모 저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <p className="mb-3 text-sm font-semibold">{title}</p>
      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--ink-soft)]">{label}</p>
      <p className={`mt-0.5 text-sm ${bold ? "font-bold text-[var(--ink)]" : "text-[var(--ink)]"}`}>{value || "-"}</p>
    </div>
  );
}
function Pill({ text, muted, warning }: { text: string; muted?: boolean; warning?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
      warning ? "bg-[#FBE9D3] text-[var(--amber)]"
      : muted ? "bg-[var(--sand-deep)] text-[var(--ink-soft)]"
      : "bg-[var(--mint-soft)] text-[var(--mint)]"}`}>
      {text}
    </span>
  );
}

/** 관리자 예약 시간대 변경 패널 */
function SlotChangePanel({
  reservationId,
  currentDate,
  currentSlot,
  onDone,
}: {
  reservationId: number;
  currentDate: string;
  currentSlot: string;
  onDone: () => void;
}) {
  const [date, setDate] = useState(currentDate);
  const [slot, setSlot] = useState<"morning" | "afternoon">(
    currentSlot === "morning" ? "morning" : "afternoon"
  );
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleChange() {
    if (!date) { setMsg({ type: "err", text: "날짜를 입력해주세요." }); return; }
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/reservations/${reservationId}/slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, timeSlot: slot }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ type: "ok", text: `${date} ${slot === "morning" ? "오전" : "오후"}으로 변경되었습니다.` });
        onDone();
      } else {
        setMsg({ type: "err", text: data.error || "변경 중 오류가 발생했습니다." });
      }
    } catch {
      setMsg({ type: "err", text: "네트워크 오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <p className="text-sm font-semibold">예약 시간대 변경</p>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">
        현재: {currentDate || "미정"} / {currentSlot === "morning" ? "오전" : currentSlot === "afternoon" ? "오후" : "시간미지정"}
      </p>
      {msg && (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}
      <div className="mt-3 space-y-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm focus:border-[var(--mint)] focus:outline-none"
        />
        <div className="flex gap-2">
          {(["morning", "afternoon"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlot(s)}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium transition ${slot === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] hover:bg-[var(--sand-deep)]"}`}
            >
              {s === "morning" ? "오전" : "오후"}
            </button>
          ))}
        </div>
        <button
          disabled={loading}
          onClick={handleChange}
          className="w-full rounded-lg border border-[var(--line)] py-2 text-sm font-medium hover:bg-[var(--sand-deep)] disabled:opacity-50"
        >
          {loading ? "변경 중..." : "시간대 변경"}
        </button>
      </div>
    </div>
  );
}

/** extra_notes 내 [내부메타] JSON 파싱하여 관리자 화면에 표시 */
function MetaInfoPanel({ notes }: { notes: string | null }) {
  if (!notes) return null;
  const idx = notes.indexOf("[내부메타]");
  if (idx === -1) return null;
  const jsonStr = notes.slice(idx + "[내부메타]".length).trim();
  const brace = jsonStr.indexOf("{");
  if (brace === -1) return null;
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(jsonStr.slice(brace)); } catch { return null; }
  if (Object.keys(meta).length === 0) return null;

  const pet = meta.pet as Record<string, unknown> | undefined;
  const moveOut = meta.moveOutTime as string | undefined;
  const moveIn = meta.moveInTime as string | undefined;
  const jipPkg = meta.jipjeongriPackage as string | undefined;
  const jipSpaces = meta.jipjeongriSpaces as string[] | undefined;

  return (
    <div className="col-span-2 rounded-lg border border-[var(--line)] bg-[var(--sand-deep)] p-3 text-xs space-y-1">
      <p className="font-semibold text-[var(--ink-soft)] mb-1.5">📋 예약 추가 정보</p>
      {pet && (
        <div className="space-y-0.5">
          <p className="font-semibold">반려동물</p>
          <p>종류: {String(pet.type || "-")} / {String(pet.count || "-")}마리</p>
          <p>털 오염: {String(pet.hairSoil || "-")} / 냄새: {pet.smell ? "있음" : "없음"} / 배변: {pet.feces ? "있음" : "없음"}</p>
          {pet.note != null && String(pet.note) && <p>메모: {String(pet.note)}</p>}
        </div>
      )}
      {(moveOut || moveIn) && (
        <div className="space-y-0.5">
          <p className="font-semibold">사이청소 일정</p>
          {moveOut && <p>퇴거 완료 예정: {new Date(moveOut).toLocaleString("ko-KR")}</p>}
          {moveIn && <p>입주 예정: {new Date(moveIn).toLocaleString("ko-KR")}</p>}
        </div>
      )}
      {(jipPkg || (jipSpaces && jipSpaces.length > 0)) && (
        <div className="space-y-0.5">
          <p className="font-semibold">집정리</p>
          {jipPkg && <p>패키지: {jipPkg}</p>}
          {jipSpaces && jipSpaces.length > 0 && <p>공간: {jipSpaces.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

/** 관리자 최종 견적금액 입력 패널 */
function FinalTotalPanel({
  reservationId,
  priceConfirmed,
  currentTotal,
  estimatedTotal,
  onDone,
}: {
  reservationId: number;
  priceConfirmed: number | null;
  currentTotal: number | null;
  estimatedTotal: number | null;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(currentTotal ?? ""));
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const isUnconfirmed = priceConfirmed === 0;

  async function handleSave() {
    if (!amount || isNaN(Number(amount))) {
      setMsg({ type: "err", text: "올바른 금액을 입력해주세요." });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/reservations/${reservationId}/final-total`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ type: "ok", text: "최종 견적금액이 저장됐습니다." });
        onDone();
      } else {
        setMsg({ type: "err", text: data.error || "저장 실패" });
      }
    } catch {
      setMsg({ type: "err", text: "네트워크 오류" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`rounded-2xl border p-5 ${isUnconfirmed ? "border-[var(--amber)]" : "border-[var(--line)]"} bg-white`}>
      <p className="text-sm font-semibold">
        {isUnconfirmed ? "⚠ 최종 견적금액 확인 필요" : "최종 견적금액 입력"}
      </p>
      <p className="mt-1 text-xs text-[var(--ink-soft)]">
        {isUnconfirmed
          ? "이 예약은 미확정 견적입니다. 고객과 협의 후 최종금액을 입력해주세요."
          : "자동견적 외 별도 협의 금액이 있는 경우 입력합니다."}
        {estimatedTotal != null && (
          <span className="ml-1">(자동견적: {estimatedTotal.toLocaleString("ko-KR")}원{isUnconfirmed ? "~" : ""})</span>
        )}
      </p>
      {msg && (
        <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="최종 확정금액 (원)"
          min={0}
          className="flex-1 rounded-lg border border-[var(--line)] px-3 py-2 text-sm focus:border-[var(--mint)] focus:outline-none"
        />
        <button
          disabled={loading}
          onClick={handleSave}
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium hover:bg-[var(--sand-deep)] disabled:opacity-50"
        >
          {loading ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
