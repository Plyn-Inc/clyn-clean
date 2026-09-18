export const revalidate = 60;

import { Suspense } from "react";
import NoticePopup from "@/components/NoticePopup";
import HeroBanner from "@/components/HeroBanner";
import MarketingAttributionCapture from "@/components/MarketingAttributionCapture";
import OneRoomTrustPoints from "@/components/OneRoomTrustPoints";
import OneRoomOfferSection from "@/components/OneRoomOfferSection";
import OneRoomScope from "@/components/OneRoomScope";
import BeforeAfterGallery from "@/components/BeforeAfterGallery";
import ServiceList, { SectionHeading } from "@/components/ServiceList";
import CleaningPortfolio from "@/components/CleaningPortfolio";
import CtaBanner from "@/components/CtaBanner";
import DetailCleaningFocus from "@/components/DetailCleaningFocus";
import ReviewsPreview from "@/components/ReviewsPreview";
import BlogPreview from "@/components/BlogPreview";
import ContactSection from "@/components/ContactSection";
import { fallbackCompanySettings, getCompanySettingsSafe } from "@/lib/settings";
import { getOneRoomOffer } from "@/lib/offers";

export default async function Home() {
  const company = fallbackCompanySettings();
  const offer = await getOneRoomOffer().catch(() => null);

  return (
    <>
      <MarketingAttributionCapture />
      <NoticePopup />
      <HeroBanner kakaoUrl={company.kakaoUrl} phone={company.phone} offer={offer} />

      <OneRoomTrustPoints />
      <OneRoomOfferSection offer={offer} />
      <OneRoomScope />
      <BeforeAfterGallery />

      <Suspense fallback={<SectionPlaceholder />}>
        <ReviewsPreview />
      </Suspense>

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
