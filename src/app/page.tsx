export const dynamic = "force-dynamic";
import HeroBanner from "@/components/HeroBanner";
import BookingSection from "@/components/booking/BookingSection";
import ServiceList from "@/components/ServiceList";
import WorkScopeSection from "@/components/WorkScopeSection";
import ExtraOptionsSection from "@/components/ExtraOptionsSection";
import ReviewsPreview from "@/components/ReviewsPreview";
import BlogPreview from "@/components/BlogPreview";
import ContactSection from "@/components/ContactSection";
import { getCompanySettings } from "@/lib/settings";
import { SectionHeading } from "@/components/ServiceList";

export default async function Home() {
  const company = await getCompanySettings();

  return (
    <>
      <HeroBanner kakaoUrl={company.kakaoUrl} phone={company.phone} />

      <section className="bg-[var(--sand)] py-16 md:py-20">
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

      <ServiceList />
      <WorkScopeSection />
      <ExtraOptionsSection />
      <ReviewsPreview />
      <BlogPreview />
      <ContactSection company={company} />
    </>
  );
}
