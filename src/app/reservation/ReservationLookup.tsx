"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RESERVATION_STATUS_LABEL, PAYMENT_STATUS_LABEL, EXTRA_OPTIONS } from "@/lib/types";
import type { Reservation, Payment, ReservationStatus, PaymentStatus } from "@/lib/types";

export default function ReservationLookup() {
  const searchParams = useSearchParams();
  const [code, setCode] = useState(searchParams.get("code") || "");
  const [phone, setPhone] = useState(searchParams.get("phone") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);

  // URL 파라미터로 자동 조회
  useEffect(() => {
    const codeParam = searchParams.get("code");
    const phoneParam = searchParams.get("phone");
    if (codeParam && phoneParam) {
      handleSearch(codeParam, phoneParam);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch(searchCode?: string, searchPhone?: string) {
    const c = searchCode ?? code;
    const p = searchPhone ?? phone;
    if (!c.trim() || !p.trim()) {
      setError("예약번호와 연락처를 모두 입력해주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setReservation(null);
    setPayment(null);

    try {
      const res = await fetch(
        `/api/reservations/lookup?code=${encodeURIComponent(c)}&phone=${encodeURIComponent(p)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "예약 정보를 찾을 수 없습니다.");
      } else {
        setReservation(data.reservation);
        setPayment(data.payment);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const extraOptions: string[] = (() => {
    try { return JSON.parse(reservation?.extra_options || "[]"); } catch { return []; }
  })();

  type OptionSnapshot = { key: string; label: string; price: number; isConsult: boolean };
  const optionSnapshot: OptionSnapshot[] = (() => {
    try {
      const parsed = JSON.parse(reservation?.option_breakdown_snapshot || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const optionMap = new Map<string, string>(EXTRA_OPTIONS.map(o => [o.key as string, o.label as string]));
  const legacyConsultKeys = new Set(["hood_filter","drain_trap","parts_replace","minor_repair","silicone_repair","pet_extra","outer_window","heavy_mold","heavy_stain","appliance_inside","extra_furniture","hidden_closet","hidden_storage","extra_pantry"]);
  const displayOptions: OptionSnapshot[] = optionSnapshot.length > 0
    ? optionSnapshot
    : extraOptions.map((key) => ({
        key,
        label: optionMap.get(key) ?? key,
        price: 0,
        isConsult: legacyConsultKeys.has(key),
      }));
  const confirmedOpts = displayOptions.filter((opt) => !opt.isConsult);
  const consultOpts = displayOptions.filter((opt) => opt.isConsult);

  const hasFinalConfirmedTotal = reservation != null && reservation.final_confirmed_total != null;
  const displayedBalance = reservation && payment
    ? reservation.final_confirmed_total != null
      ? Math.max(reservation.final_confirmed_total - payment.amount, 0)
      : reservation.estimated_balance_snapshot
    : null;

  const formatAddress = (addr: string) => {
    if (addr.length <= 6) return addr;
    return addr.slice(0, 4) + "****";
  };

  return (
    <div className="mt-8">
      <div className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">예약번호</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="예: RES-260706-XXXX"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold">연락처</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="예약 시 입력한 연락처"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
            />
          </div>
        </div>
        <button
          onClick={() => handleSearch()}
          disabled={loading}
          className="mt-4 w-full rounded-full bg-[var(--navy)] py-3 text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-60"
        >
          {loading ? "조회 중..." : "예약 조회"}
        </button>
        {error && (
          <div className="mt-4 rounded-lg bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">{error}</div>
        )}
      </div>

      {reservation && payment && (
        <div className="mt-6 space-y-4">
          {/* 상태 배지 */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line)] bg-white px-5 py-4">
            <p className="text-sm font-semibold text-[var(--ink)]">{reservation.reservation_code}</p>
            <span className="rounded-full bg-[var(--mint-soft)] px-3 py-1 text-xs font-medium text-[var(--mint)]">
              {RESERVATION_STATUS_LABEL[reservation.reservation_status as ReservationStatus]}
            </span>
            <span className="rounded-full bg-[var(--sand-deep)] px-3 py-1 text-xs font-medium text-[var(--ink-soft)]">
              {PAYMENT_STATUS_LABEL[payment.payment_status as PaymentStatus]}
            </span>
          </div>

          {/* 청소 정보 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="mb-3 text-sm font-semibold">청소 정보</p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="청소 종류" value={reservation.service_type} />
              <Row label="희망 날짜" value={reservation.desired_date || "미정"} />
              <Row label="지역" value={reservation.region} />
              <Row label="주소" value={formatAddress(reservation.address)} />
              {reservation.area_pyeong && <Row label="평수" value={`${reservation.area_pyeong}평`} />}
            </div>
            {displayOptions.length > 0 && (
              <div className="mt-3 space-y-2">
                {confirmedOpts.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-[var(--ink-soft)]">추가서비스:</p>
                    {confirmedOpts.map((opt) => (
                      <p key={opt.key} className="text-sm text-[var(--ink-soft)]">
                        · {opt.label}{opt.price > 0 ? ` — ${opt.price.toLocaleString("ko-KR")}원` : ""}
                      </p>
                    ))}
                  </div>
                )}
                {consultOpts.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-[var(--ink-soft)]">별도 상담 항목:</p>
                    {consultOpts.map((opt) => (
                      <p key={opt.key} className="text-sm text-[var(--ink-soft)]">
                        · {opt.label} — 작업 전 금액 안내
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 금액 정보 */}
          <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="mb-3 text-sm font-semibold">금액 안내</p>
            <div className="space-y-1.5 text-sm">
              {hasFinalConfirmedTotal ? (
                <>
                  {reservation.base_price_snapshot != null && reservation.base_price_snapshot > 0 && (
                    <Row label="기본 청소금액" value={`${reservation.base_price_snapshot.toLocaleString("ko-KR")}원`} />
                  )}
                  {reservation.instant_discount_snapshot != null && reservation.instant_discount_snapshot > 0 && reservation.instant_discount_eligible === 1 && (
                    <Row label="즉시예약 할인" value={`- ${reservation.instant_discount_snapshot.toLocaleString("ko-KR")}원 (잔금에서 차감)`} />
                  )}
                  <Row label="최종 확정금액" value={`${reservation.final_confirmed_total!.toLocaleString("ko-KR")}원`} bold />
                </>
              ) : reservation.estimated_total_snapshot != null && reservation.estimated_total_snapshot > 0 ? (
                reservation.price_confirmed_snapshot === 0 ? (
                  <div className="rounded-lg bg-[#FBE9D3] px-3 py-2 text-xs text-[var(--amber)]">
                    ℹ 이 예약의 기본 견적은 <strong>{reservation.estimated_total_snapshot.toLocaleString("ko-KR")}원부터</strong>입니다.
                    실제 평수와 구조 확인 후 담당자가 최종 금액을 안내드립니다.
                  </div>
                ) : (
                  <>
                    {reservation.base_price_snapshot != null && reservation.base_price_snapshot > 0 && (
                      <Row label="기본 청소금액" value={`${reservation.base_price_snapshot.toLocaleString("ko-KR")}원`} />
                    )}
                    {reservation.instant_discount_snapshot != null && reservation.instant_discount_snapshot > 0 && reservation.instant_discount_eligible === 1 && (
                      <Row label="즉시예약 할인" value={`- ${reservation.instant_discount_snapshot.toLocaleString("ko-KR")}원 (잔금에서 차감)`} />
                    )}
                    <Row label="예상 총금액" value={`${reservation.estimated_total_snapshot.toLocaleString("ko-KR")}원`} bold />
                  </>
                )
              ) : (
                <p className="text-[var(--ink-soft)]">청소 요금은 상담 후 안내드립니다.</p>
              )}
              <div className="h-px bg-[var(--line)]" />
              <Row label="예약금" value={`${payment.amount.toLocaleString("ko-KR")}원`} />
              {displayedBalance != null && (
                <Row
                  label={hasFinalConfirmedTotal ? "잔금" : "예상 잔금"}
                  value={`${displayedBalance.toLocaleString("ko-KR")}원`}
                />
              )}
              {payment.payment_due_date && (
                <Row
                  label="입금 기한"
                  value={new Date(payment.payment_due_date).toLocaleString("ko-KR")}
                />
              )}
            </div>
          </div>

          {/* 입금 계좌 (입금 대기 상태일 때) */}
          {payment.payment_status === "pending" && (
            <div className="rounded-2xl border border-[var(--amber)] bg-[#FBE9D3] p-5">
              <p className="text-sm font-semibold text-[var(--amber)]">⏳ 선입금 대기 중</p>
              <p className="mt-2 text-sm text-[var(--amber)]/80">
                선입금을 완료해주시면 입금 확인 후 담당자가 일정과 신청내용을 검토합니다. 입금자명을 예약자명과 동일하게 입력해주세요.
              </p>
            </div>
          )}

          {/* 선입금 확인 / 관리자 확정 대기 */}
          {payment.payment_status === "confirmed" && reservation.reservation_status === "awaiting_admin_check" && (
            <div className="rounded-2xl border border-[var(--mint)] bg-[var(--mint-soft)] p-5">
              <p className="text-sm font-semibold text-[var(--mint)]">✓ 선입금 확인 / 예약확정 대기</p>
              <p className="mt-2 text-sm text-[var(--mint)]/80">
                선입금이 확인되었습니다. 담당자가 일정과 신청내용을 최종 확인하고 있습니다.
              </p>
            </div>
          )}

          {/* 최종 예약 확정 */}
          {reservation.reservation_status === "confirmed" && (
            <div className="rounded-2xl border border-[var(--navy)] bg-[var(--navy)]/5 p-5">
              <p className="text-sm font-semibold text-[var(--navy)]">✅ 예약 확정</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                예약이 최종 확정되었습니다.
              </p>
            </div>
          )}

          {/* 취소/변경 요청 안내 */}
          <div className="rounded-xl bg-[var(--sand-deep)] px-4 py-3 text-xs text-[var(--ink-soft)]">
            예약 변경 또는 취소를 원하시면 아래 문의 수단으로 연락해주세요. 직접 취소하는 기능은 제공되지 않습니다.
          </div>

          <a href="/contact" className="block w-full rounded-full border border-[var(--navy)] py-3 text-center text-sm font-semibold text-[var(--navy)] transition hover:bg-[var(--navy)] hover:text-white">
            문의하기
          </a>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--ink-soft)]">{label}</span>
      <span className={bold ? "font-bold text-[var(--ink)]" : ""}>{value}</span>
    </div>
  );
}
