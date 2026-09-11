export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getAllSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "취소 및 환불 정책",
  alternates: { canonical: "/refund" },
};

export default async function RefundPage() {
  let content = "";
  try {
    const settings = await getAllSettings();
    content = settings.refund_policy_content || "";
  } catch { /* DB 미준비 */ }

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold">취소 및 환불 정책</h1>
      {content ? (
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink-soft)]">
          {content}
        </div>
      ) : (
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-[var(--ink-soft)]">
          <p>취소 및 환불 정책은 현재 준비 중입니다.</p>
          <p className="rounded-xl bg-[var(--sand-deep)] p-4">
            <strong>안내:</strong> 예약 취소·변경 및 환불 관련 정책은 확정 후 이 페이지에 게시됩니다.
            현재 정책 문의는 아래 연락처로 문의해주세요.
          </p>
          <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
            ※ 취소 수수료율과 환불 비율 등 세부 기준은 정책 확정 후 안내드립니다.
            반려동물이 있었던 공간은 상담을 통해 작업 범위와 금액을 확인한 뒤 진행합니다.
          </p>
          <a href="/contact" className="text-[var(--mint)] hover:underline">문의하기</a>
        </div>
      )}
    </div>
  );
}
