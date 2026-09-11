import Image from "next/image";
import { DETAIL_CASES, CASE_DISCLAIMER } from "@/lib/images";
import { SectionHeading } from "./ServiceList";

/**
 * Detail Cleaning Focus — 배수구/천장 설비 등 눈에 잘 띄지 않는 부분까지
 * 확인하는 작업 사례를 이미지 중심으로 보여준다.
 */
export default function DetailCleaningFocus() {
  return (
    <section className="bg-[var(--sand)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="디테일"
          title="디테일까지 확인하는 청소"
          desc="보이는 표면만 닦고 끝내지 않습니다. 배수구 안쪽, 천장 설비처럼 눈에 잘 띄지 않는 부분까지 확인합니다."
        />

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {DETAIL_CASES.map((c) => (
            <figure key={c.title} className="overflow-hidden rounded-2xl bg-white">
              <div className="relative aspect-[4/5]">
                <Image
                  src={c.image.src}
                  alt={c.image.alt}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover"
                />
              </div>
              <figcaption className="px-5 py-4">
                <p className="font-display text-base font-bold text-[var(--ink)]">{c.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">{c.description}</p>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="mt-5 text-xs text-[var(--ink-soft)]">{CASE_DISCLAIMER}</p>
      </div>
    </section>
  );
}
