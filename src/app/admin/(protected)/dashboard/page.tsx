export const dynamic = "force-dynamic";
import Link from "next/link";
import { getDashboardStats, listReservations } from "@/lib/reservations";
import { RESERVATION_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/types";
import type { ReservationStatus, PaymentStatus } from "@/lib/types";

export default async function AdminDashboardPage() {
  const stats = await getDashboardStats();
  const recent = (await listReservations()).slice(0, 8);

  return (
    <div>
      <h1 className="font-display text-xl font-bold">대시보드</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="전체 예약" value={stats.total} />
        <StatCard label="입금 확인 대기" value={stats.awaitingDeposit} accent="amber" />
        <StatCard label="예약 확정" value={stats.confirmed} accent="mint" />
        <StatCard label="상담 필요" value={stats.consultRequired} accent="rose" />
      </div>

      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <p className="text-sm font-semibold">최근 예약</p>
          <Link href="/admin/reservations" className="text-xs font-medium text-[var(--mint)] hover:underline">
            전체 보기 →
          </Link>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {recent.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-[var(--ink-soft)]">예약 내역이 없습니다.</p>
          )}
          {recent.map((r) => (
            <Link
              key={r.id}
              href={`/admin/reservations/${r.id}`}
              className="flex flex-col gap-1 px-5 py-3.5 text-sm hover:bg-[var(--sand-deep)] sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {r.customer_name} · {r.service_type}
                </p>
                <p className="text-xs text-[var(--ink-soft)]">
                  {r.reservation_code} · {r.desired_date || "날짜 미정"}
                </p>
              </div>
              <div className="flex gap-2">
                <Badge text={RESERVATION_STATUS_LABEL[r.reservation_status as ReservationStatus]} />
                <Badge text={PAYMENT_STATUS_LABEL[r.payment_status as PaymentStatus]} muted />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "amber" | "mint" | "rose";
}) {
  const color =
    accent === "amber"
      ? "text-[var(--amber)]"
      : accent === "mint"
        ? "text-[var(--mint)]"
        : accent === "rose"
          ? "text-[var(--rose)]"
          : "text-[var(--ink)]";
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <p className="text-xs font-medium text-[var(--ink-soft)]">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Badge({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        muted ? "bg-[var(--sand-deep)] text-[var(--ink-soft)]" : "bg-[var(--mint-soft)] text-[var(--mint)]"
      }`}
    >
      {text}
    </span>
  );
}
