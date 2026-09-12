export const dynamic = "force-dynamic";
import { Suspense } from "react";
import HeroBanner from "@/components/HeroBanner";
import BookingSection from "@/components/booking/BookingSection";
import ServiceList from "@/components/ServiceList";
import WorkScopeSection from "@/components/WorkScopeSection";
import BeforeAfterGallery from "@/components/BeforeAfterGallery";
import CleaningPortfolio from "@/components/CleaningPortfolio";
import CtaBanner from "@/components/CtaBanner";
import DetailCleaningFocus from "@/components/DetailCleaningFocus";
import ReviewsPreview from "@/components/ReviewsPreview";
import BlogPreview from "@/components/BlogPreview";
import ContactSection from "@/components/ContactSection";
import { fallbackCompanySettings, getCompanySettingsSafe } from "@/lib/settings";
import { SectionHeading } from "@/components/ServiceList";

/**
 * 홈페이지 first render는 DB를 기다리지 않는다.
 *
 * 회사정보는 코드 상수(BRAND_FALLBACK)로 즉시 렌더링하고,
 * DB 기반 콘텐츠(후기/블로그/문의처)는 Suspense 경계 안의 async child로 분리한다.
 * DB가 느리거나 unavailable이어도 홈페이지 shell은 즉시 응답한다.
 */
export default function Home() {
  // DB 접근 없이 즉시 사용 가능한 브랜드 기본정보
  const company = fallbackCompanySettings();

  return (
    <>
      <HeroBanner kakaoUrl={company.kakaoUrl} phone={company.phone} />


      <ServiceList />
      <BeforeAfterGallery />
      <section id="reserve" className="scroll-mt-24 bg-[var(--sand)] py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <SectionHeading
            eyebrow="예약"
            title="예약 가능 날짜 확인 후 바로 예약하세요"
            desc="캘린더에서 예약 가능 날짜를 클릭하면 선택한 날짜가 예약 입력란에 자동으로 입력됩니다. 날짜를 정하지 않았다면 바로 예약하기로 진행해도 괜찮습니다."
          />
          <div className="mt-10">
            <BookingSection />
          </div>
        </div>
      </section>
      <WorkScopeSection />
      <CleaningPortfolio />
      <DetailCleaningFocus />
      {/* DB 기반 콘텐츠는 shell 렌더를 막지 않도록 Suspense로 분리한다 */}
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

/** DB 기반 섹션 로딩 중 자리표시 — 레이아웃 이동을 줄인다 */
function SectionPlaceholder() {
  return <div className="py-16" aria-hidden />;
}

/**
 * 문의 섹션은 DB 설정(전화/카카오)을 쓰므로 async child로 분리한다.
 * 조회 실패 시 브랜드 기본값으로 렌더링한다.
 */
async function ContactSectionAsync() {
  const company = await getCompanySettingsSafe();
  return <ContactSection company={company} />;
}
