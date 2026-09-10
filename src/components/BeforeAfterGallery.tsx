import Image from "next/image";
import { BEFORE_AFTER_PAIRS, CASE_DISCLAIMER } from "@/lib/images";
import { SectionHeading } from "./ServiceList";

/**
 * 실제 작업 Before / After 비교 섹션.
 *
 * 구도가 완전히 동일하지 않은 쌍이 있으므로 겹침형 슬라이더가 아니라
 * 안정적인 2분할 카드로 표시한다. 두 이미지의 프레임 높이를 동일하게 맞춘다.
 */
export default function BeforeAfterGallery() {
  return (
    <section className="bg-[var(--sand)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="실제 청소 결과"
          title="말보다 결과로 보여드립니다"
          desc="Clyn Clean이 실제 현장에서 진행한 청소 사례입니다."
        />

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {BEFORE_AFTER_PAIRS.map((pair) => (
            <div
              key={pair.id}
              className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white"
            >
              <div className="grid grid-cols-2">
                <figure className="relative">
                  {/* aspect-ratio로 영역을 선점해 CLS를 방지한다 */}
                  <div className="relative aspect-[3/4]">
                    <Image
                      src={pair.before.src}
                      alt={pair.before.alt}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover"
                    />
                  </div>
                  <figcaption className="absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
                    BEFORE
                  </figcaption>
                </figure>
                <figure className="relative border-l border-white/40">
                  <div className="relative aspect-[3/4]">
                    <Image
                      src={pair.after.src}
                      alt={pair.after.alt}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover"
                    />
                  </div>
                  <figcaption className="absolute left-2 top-2 rounded bg-[var(--mint)] px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">
                    AFTER
                  </figcaption>
                </figure>
              </div>
              <p className="px-4 py-3 text-sm font-semibold text-[var(--ink)]">{pair.title}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 text-xs text-[var(--ink-soft)]">{CASE_DISCLAIMER}</p>
      </div>
    </section>
  );
}
