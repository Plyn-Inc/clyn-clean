export const revalidate = 60;

import type { Metadata } from "next";
import { Suspense } from "react";
import OneRoomLandingHero from "@/components/OneRoomLandingHero";
import MarketingAttributionCapture from "@/components/MarketingAttributionCapture";
import OneRoomTrustPoints from "@/components/OneRoomTrustPoints";
import BeforeAfterGallery from "@/components/BeforeAfterGallery";
import OneRoomScope from "@/components/OneRoomScope";
import BookingSection from "@/components/booking/BookingSection";
import ReviewsPreview from "@/components/ReviewsPreview";
import MobileStickyCta from "@/components/MobileStickyCta";
import { SectionHeading } from "@/components/ServiceList";
import { fallbackCompanySettings } from "@/lib/settings";
import { getOneRoomOffer } from "@/lib/offers";

export const metadata: Metadata = {
  title: "일반 원룸 입주·퇴실청소",
  description: "일반 단층 원룸 입주·퇴실청소 예약 가능일과 CLYN OPEN PRICE를 확인하세요.",
  alternates: { canonical: "/one-room" },
};

export default async function OneRoomPage() {
  const company = fallbackCompanySettings();
  const offer = await getOneRoomOffer().catch(() => null);

  return (
    <>
      <MarketingAttributionCapture />
      <OneRoomLandingHero offer={offer} />
      <OneRoomTrustPoints />
      <BeforeAfterGallery />
      <OneRoomScope />

      <section className="bg-white py-12 md:py-14">
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--sand)] p-5 text-sm leading-relaxed text-[var(--ink-soft)]">
            <strong className="text-[var(--navy)]">온라인 예약 대상:</strong> 일반 단층 원룸 · 단층 오피스텔형 원룸
            <br />
            <strong className="text-[var(--rose)]">대상 제외:</strong> 1.5룸 · 원룸 복층 · 투룸 이상 · 구조상 별도 확인이 필요한 공간
          </div>
        </div>
      </section>

      <section id="reserve" className="scroll-mt-24 bg-[var(--sand)] py-16 pb-28 md:py-20 md:pb-20">
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <SectionHeading
            eyebrow="빠른 예약"
            title="지역과 날짜를 확인하고 일반 원룸 예약을 진행하세요"
            desc="입주청소·일반 원룸 상품은 미리 선택되어 있습니다. 지역, 날짜, 입주 전/퇴거 후 상태와 연락처만 확인하면 됩니다."
          />
          <div className="mt-10">
            <BookingSection mode="one-room" />
          </div>
        </div>
      </section>

      <Suspense fallback={<div className="py-16" aria-hidden />}>
        <ReviewsPreview />
      </Suspense>
      <MobileStickyCta kakaoUrl={company.kakaoUrl} />
    </>
  );
}
