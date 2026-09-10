"use client";

import { useState } from "react";

/**
 * 예약금 입금 계좌 확인 화면.
 *
 * 계좌정보는 이 컴포넌트가 마운트될 때 서버에서 처음 받아온다.
 * 초기 HTML이나 예약 생성 응답에는 계좌번호가 포함되지 않는다.
 */
export interface DepositAccountInfo {
  reservationCode: string;
  customerName: string;
  workArea: string;
  desiredDate: string | null;
  timeSlot: string;
  totalAmount: number | null;
  depositAmount: number | null;
  balanceAmount: number | null;
  vatNotice: string;
  account: { bankName: string; accountNumber: string; accountHolder: string };
  depositDeadline: string | null;
  depositDeadlineHours: number;
}

export default function DepositAccountPanel({ info }: { info: DepositAccountInfo }) {
  const [copied, setCopied] = useState(false);

  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(info.account.accountNumber.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드 미지원 환경 */
    }
  }

  const slotLabel = info.timeSlot === "morning" ? "오전" : info.timeSlot === "afternoon" ? "오후" : "-";

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-6 shadow-sm md:p-8">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--mint-soft)] text-2xl text-[var(--mint)]">
        ✓
      </div>
      <h3 className="text-center font-display text-xl font-bold">예약금 입금 계좌 확인</h3>
      <p className="mt-2 text-center text-sm text-[var(--ink-soft)]">
        아래 계좌로 예약금을 입금해주시면 담당자가 확인 후 예약을 확정합니다.
      </p>

      {/* 예약 정보 */}
      <dl className="mt-6 space-y-2 rounded-xl bg-[var(--sand-deep)] p-5 text-sm">
        <Row label="예약번호" value={info.reservationCode} strong />
        <Row label="예약자" value={info.customerName} />
        <Row label="작업지역" value={info.workArea} />
        <Row label="예약일" value={info.desiredDate ?? "-"} />
        <Row label="예약시간" value={slotLabel} />
      </dl>

      {/* 금액 — 총액 = 예약금 + 잔금 */}
      <dl className="mt-3 space-y-2 rounded-xl border border-[var(--line)] p-5 text-sm">
        {info.totalAmount != null && (
          <Row label="총 청소금액" value={`${info.totalAmount.toLocaleString("ko-KR")}원`} />
        )}
        {info.depositAmount != null && (
          <Row label="예약 선금" value={`${info.depositAmount.toLocaleString("ko-KR")}원`} strong />
        )}
        {info.balanceAmount != null && (
          <Row label="현장 잔금" value={`${info.balanceAmount.toLocaleString("ko-KR")}원`} />
        )}
        <p className="pt-1 text-xs text-[var(--ink-soft)]">※ {info.vatNotice}</p>
        <p className="text-xs text-[var(--ink-soft)]">
          예약 선금은 총 청소금액에 포함된 금액이며 추가 비용이 아닙니다. 잔금은 청소 완료 후 현장에서 정산합니다.
        </p>
      </dl>

      {/* 입금 계좌 */}
      <div className="mt-3 rounded-xl border-2 border-[var(--mint)] bg-[var(--mint-soft)] p-5">
        <p className="mb-3 text-sm font-bold text-[var(--mint)]">입금 계좌</p>
        <dl className="space-y-2 text-sm">
          <Row label="은행" value={info.account.bankName} />
          <Row label="예금주" value={info.account.accountHolder} />
        </dl>
        <div className="mt-3 flex items-center gap-2">
          <p className="flex-1 select-all break-all font-display text-lg font-bold text-[var(--navy)]">
            {info.account.accountNumber}
          </p>
          <button
            type="button"
            onClick={copyAccount}
            className="shrink-0 rounded-lg border border-[var(--mint)] bg-white px-3 py-2 text-xs font-semibold text-[var(--mint)]"
          >
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
      </div>

      {/* 입금 기한 */}
      <div className="mt-3 rounded-xl bg-[#FBE9D3] p-4 text-sm text-[var(--amber)]">
        <p className="font-semibold">
          입금 기한: {info.depositDeadline ? new Date(info.depositDeadline).toLocaleString("ko-KR") : `${info.depositDeadlineHours}시간 이내`}
        </p>
        <p className="mt-1 text-xs leading-relaxed">
          계좌 안내 시점부터 {info.depositDeadlineHours}시간 안에 입금이 확인되지 않으면
          해당 날짜·시간이 자동으로 해제됩니다.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--ink-soft)]">{label}</dt>
      <dd className={`text-right ${strong ? "font-bold text-[var(--ink)]" : ""}`}>{value}</dd>
    </div>
  );
}
