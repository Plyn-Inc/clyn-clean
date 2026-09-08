export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getAllSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "서비스 이용약관",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  let content = "";
  try {
    const settings = await getAllSettings();
    content = settings.terms_content || "";
  } catch { /* DB 미준비 */ }

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold">서비스 이용약관</h1>
      {content ? (
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink-soft)]">
          {content}
        </div>
      ) : (
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-[var(--ink-soft)]">
          <p>서비스 이용약관은 관리자 설정에서 입력할 수 있습니다.</p>
          <p>예약 서비스 이용에 관한 세부 약관은 준비 중입니다. 문의사항은 아래 연락처로 문의해주세요.</p>
          <a href="/contact" className="text-[var(--mint)] hover:underline">문의하기</a>
        </div>
      )}
    </div>
  );
}
