export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import ConsultationForm from "./ConsultationForm";

export const metadata: Metadata = {
  title: "상담 접수",
  description: "40평 이상, 반려동물 동거 등 별도 확인이 필요한 청소는 상담 접수를 통해 안내드립니다.",
  alternates: { canonical: "/consultation" },
};

export default function ConsultationPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-14 md:px-8 md:py-20">
      <p className="text-xs font-semibold tracking-wide text-[var(--mint)]">CONSULTATION</p>
      <h1 className="mt-2 font-display text-2xl font-bold md:text-3xl">상담 접수</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        40평 이상, 반려동물 동거, 그 밖에 현장 조건 확인이 필요한 청소는 상담 접수를 통해 안내드립니다.
        접수해주시면 담당자가 확인 후 영업일 기준 24시간 이내 연락드립니다.
      </p>
      <div className="mt-8">
        <ConsultationForm />
      </div>
    </div>
  );
}
