import Image from "next/image";
import { PORTFOLIO_ITEMS, CASE_DISCLAIMER } from "@/lib/images";
import { SectionHeading } from "./ServiceList";

/**
 * 공간별 작업 사례 갤러리 + 디테일 사례.
 *
 * After 컷만 사용한다. 카테고리별 대표 1장씩만 노출해 페이지가 길어지지 않게 한다.
 */
export default function CleaningPortfolio() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="작업 사례"
          title="공간별 청소 결과"
          desc="거실부터 현관까지, 실제 완료된 현장 사진입니다."
        />

        <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {PORTFOLIO_ITEMS.map((item) => (
            <figure key={item.category} className="overflow-hidden rounded-2xl border border-[var(--line)]">
              <div className="relative aspect-[3/4]">
                <Image
                  src={item.image.src}
                  alt={item.image.alt}
                  fill
                  sizes="(max-width: 1024px) 50vw, 25vw"
                  className="object-cover"
                />
              </div>
              <figcaption className="bg-white px-3 py-2.5 text-sm font-semibold text-[var(--ink)]">
                {item.category}
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-5 text-xs text-[var(--ink-soft)]">{CASE_DISCLAIMER}</p>

      </div>
    </section>
  );
}
