export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import ReservationLookup from "./ReservationLookup";

export const metadata: Metadata = {
  title: "예약 조회",
  description: "예약번호와 연락처로 예약 내역을 확인하세요.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ReservationPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold">예약 조회</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        예약번호와 예약 시 입력하신 연락처를 입력하면 예약 내역을 확인할 수 있습니다.
      </p>
      <ReservationLookup />
    </div>
  );
}
