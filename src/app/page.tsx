export const dynamic = "force-dynamic";

import { Suspense } from "react";
import NoticePopup from "@/components/NoticePopup";
import HeroBanner from "@/components/HeroBanner";
import MarketingAttributionCapture from "@/components/MarketingAttributionCapture";
import OneRoomTrustPoints from "@/components/OneRoomTrustPoints";
import OneRoomOfferSection from "@/components/OneRoomOfferSection";
import OneRoomScope from "@/components/OneRoomScope";
import BookingSection from "@/components/booking/BookingSection";
import BeforeAfterGallery from "@/components/BeforeAfterGallery";
import ServiceList, { SectionHeading } from "@/components/ServiceList";
import CleaningPortfolio from "@/components/CleaningPortfolio";
import CtaBanner from "@/components/CtaBanner";
import DetailCleaningFocus from "@/components/DetailCleaningFocus";
import ReviewsPreview from "@/components/ReviewsPreview";
import BlogPreview from "@/components/BlogPreview";
import ContactSection from "@/components/ContactSection";
import { fallbackCompanySettings, getCompanySettingsSafe } from "@/lib/settings";

/**
 * 브랜드 홈페이지.
 *
 * 기존 서비스와 예약 엔진은 유지하면서 현재 판매 우선순위인 일반 원룸을 상단에 배치한다.
 * DB 기반 콘텐츠는 Suspense child로 격리해 first shell이 DB를 기다리지 않는다.
 */
export default function Home() {
  const company = fallbackCompanySettings();

  return (
    <>
      <MarketingAttributionCapture />
      <NoticePopup />
      <HeroBanner kakaoUrl={company.kakaoUrl} phone={company.phone} />
      <OneRoomTrustPoints />
      <BeforeAfterGallery />
      <OneRoomOfferSection />
      <OneRoomScope />

      <section id="reserve" className="scroll-mt-24 bg-[var(--sand)] py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <SectionHeading
            eyebrow="예약"
            title="우리 지역과 예약 가능한 날짜를 바로 확인하세요"
            desc="서비스 가능지역을 선택하고 캘린더에서 가능한 날짜를 확인한 뒤 기존 안전한 예약 절차로 진행합니다."
          />
          <div className="mt-10">
            <BookingSection />
          </div>
        </div>
      </section>

      <section className="bg-white py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <SectionHeading
            eyebrow="CLYN CLEAN"
            title="원룸 외 청소가 필요하신가요?"
            desc="기존 청소 서비스는 그대로 운영합니다. 현재 온라인 광고에서는 일반 원룸을 우선 안내하고 있습니다."
          />
        </div>
      </section>
      <ServiceList />
      <CleaningPortfolio />
      <DetailCleaningFocus />

      <Suspense fallback={<SectionPlaceholder />}>
        <ReviewsPreview />
      </Suspense>
      <Suspense fallback={<SectionPlaceholder />}>
        <BlogPreview />
      </Suspense>
      <CtaBanner />
      <Suspense fallback={<SectionPlaceholder />}>
        <ContactSectionAsync />
      </Suspense>
    </>
  );
}

function SectionPlaceholder() {
  return <div className="py-16" aria-hidden />;
}

async function ContactSectionAsync() {
  const company = await getCompanySettingsSafe();
  return <ContactSection company={company} />;
}
