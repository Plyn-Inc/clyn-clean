"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RESERVATION_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/types";
import type { Reservation, ReservationStatus, PaymentStatus } from "@/lib/types";

type Row = Reservation & { payment_status: PaymentStatus; amount: number; depositor_name: string | null };

export default function AdminReservationsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ReservationStatus | "">("");
  const [search, setSearch] = useState("");
  const [overdueRows, setOverdueRows] = useState<(Reservation & { payment_due_date: string | null })[]>([]);
  const [tab, setTab] = useState<"all" | "overdue">("all");

  function loadMain() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (search) params.set("search", search);
    fetch(`/api/admin/reservations?${params}`)
      .then((r) => r.json())
      .then((data) => setRows(data.reservations || []))
      .finally(() => setLoading(false));
  }

  function loadOverdue() {
    fetch("/api/admin/reservations/overdue")
      .then((r) => r.json())
      .then((data) => setOverdueRows(data.reservations || []));
  }

  useEffect(() => { loadMain(); loadOverdue(); }, [statusFilter]); // eslint-disable-line

  return (
    <div>
      <h1 className="font-display text-xl font-bold">예약 관리</h1>

      {/* 탭 */}
      <div className="mt-4 flex gap-2">
        <TabBtn label="전체 예약" active={tab === "all"} onClick={() => setTab("all")} />
        <TabBtn
          label={`입금기한 초과 ${overdueRows.length > 0 ? `(${overdueRows.length})` : ""}`}
          active={tab === "overdue"}
          onClick={() => setTab("overdue")}
          warn={overdueRows.length > 0}
        />
      </div>

      {tab === "overdue" ? (
        <OverdueTable rows={overdueRows} onAction={() => { loadMain(); loadOverdue(); }} />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ReservationStatus | "")}
              className="rounded-lg border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm">
              <option value="">전체 상태</option>
              {Object.entries(RESERVATION_STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <div className="flex flex-1 gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadMain()}
                placeholder="이름, 연락처, 예약번호 검색"
                className="flex-1 rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
              <button onClick={loadMain} className="rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white">검색</button>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-soft)]">
                  <th className="px-4 py-3 font-medium">예약번호</th>
                  <th className="px-4 py-3 font-medium">예약자</th>
                  <th className="px-4 py-3 font-medium">청소 종류</th>
                  <th className="px-4 py-3 font-medium">희망일</th>
                  <th className="px-4 py-3 font-medium">예약 상태</th>
                  <th className="px-4 py-3 font-medium">입금 상태</th>
                  <th className="px-4 py-3 font-medium">즉시할인</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {loading && <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--ink-soft)]">불러오는 중...</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--ink-soft)]">예약 내역이 없습니다.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--sand-deep)]">
                    <td className="px-4 py-3">
                      <Link href={`/admin/reservations/${r.id}`} className="font-medium text-[var(--mint)] hover:underline">{r.reservation_code}</Link>
                    </td>
                    <td className="px-4 py-3">{r.customer_name}<p className="text-xs text-[var(--ink-soft)]">{r.customer_phone}</p></td>
                    <td className="px-4 py-3">{r.service_type}</td>
                    <td className="px-4 py-3">{r.desired_date || "미정"}</td>
                    <td className="px-4 py-3"><StatusPill text={RESERVATION_STATUS_LABEL[r.reservation_status]} /></td>
                    <td className="px-4 py-3"><StatusPill text={PAYMENT_STATUS_LABEL[r.payment_status]} muted /></td>
                    <td className="px-4 py-3 text-xs">{r.instant_discount_eligible ? (r.instant_discount_applied ? "적용됨" : "자격있음") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function OverdueTable({ rows, onAction }: { rows: (Reservation & { payment_due_date: string | null })[]; onAction: () => void }) {
  const [actionId, setActionId] = useState<number | null>(null);

  async function handleCancel(id: number) {
    if (!confirm("이 예약을 취소 처리하시겠습니까? 해당 날짜 잔여석이 회복됩니다.")) return;
    setActionId(id);
    try {
      await fetch(`/api/admin/reservations/${id}/cancel-overdue`, { method: "POST" });
      onAction();
    } finally {
      setActionId(null);
    }
  }

  if (rows.length === 0) return <p className="mt-8 text-sm text-[var(--ink-soft)]">입금기한이 초과된 예약이 없습니다.</p>;

  return (
    <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--amber)] bg-white">
      <div className="border-b border-[var(--amber)]/30 bg-[#FBE9D3] px-5 py-3 text-xs font-semibold text-[var(--amber)]">
        입금 기한이 지났지만 아직 입금이 확인되지 않은 예약입니다. 확인 후 직접 취소 처리해주세요.
      </div>
      <table className="w-full min-w-[700px] text-sm">
        <thead><tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-soft)]">
          <th className="px-4 py-3 font-medium">예약번호</th>
          <th className="px-4 py-3 font-medium">예약자</th>
          <th className="px-4 py-3 font-medium">희망일</th>
          <th className="px-4 py-3 font-medium">입금 기한</th>
          <th className="px-4 py-3 font-medium">처리</th>
        </tr></thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-[var(--sand-deep)]">
              <td className="px-4 py-3"><Link href={`/admin/reservations/${r.id}`} className="font-medium text-[var(--mint)] hover:underline">{r.reservation_code}</Link></td>
              <td className="px-4 py-3">{r.customer_name}</td>
              <td className="px-4 py-3">{r.desired_date || "미정"}</td>
              <td className="px-4 py-3 text-xs text-[var(--rose)]">{r.payment_due_date ? new Date(r.payment_due_date).toLocaleString("ko-KR") : "-"}</td>
              <td className="px-4 py-3">
                <button disabled={actionId === r.id} onClick={() => handleCancel(r.id)}
                  className="rounded-full border border-[var(--rose)] px-3 py-1 text-xs font-medium text-[var(--rose)] transition hover:bg-[var(--rose)] hover:text-white disabled:opacity-50">
                  수동 취소
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabBtn({ label, active, onClick, warn }: { label: string; active: boolean; onClick: () => void; warn?: boolean }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-[var(--navy)] text-white" : warn ? "border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-white" : "border border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--sand-deep)]"}`}>
      {label}
    </button>
  );
}

function StatusPill({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${muted ? "bg-[var(--sand-deep)] text-[var(--ink-soft)]" : "bg-[var(--mint-soft)] text-[var(--mint)]"}`}>
      {text}
    </span>
  );
}
