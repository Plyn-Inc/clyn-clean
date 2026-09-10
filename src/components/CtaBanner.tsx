"use client";

import Image from "next/image";
import { CTA_IMAGE } from "@/lib/images";

/**
 * 최종 예약 CTA 직전 보조 비주얼.
 * Hero와 다른 공간(주방) 이미지를 사용해 반복감을 줄이고,
 * 이미지가 버튼보다 강하게 보이지 않도록 overlay를 충분히 준다.
 */
export default function CtaBanner() {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="relative overflow-hidden">
      <div className="relative min-h-[280px] md:min-h-[340px]">
        <Image
          src={CTA_IMAGE.src}
          alt={CTA_IMAGE.alt}
          fill
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-[var(--navy-deep)]/78" aria-hidden />

        <div className="relative mx-auto flex max-w-6xl flex-col items-start justify-center px-5 py-16 md:px-8 md:py-20">
          <h2 className="font-display text-2xl font-bold leading-tight text-white md:text-3xl">
            예약 가능한 날짜를 지금 확인하세요
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#B8C0CE] md:text-base">
            원하는 날짜와 시간을 선택하고 신청하시면, 예약금 입금 계좌를 안내드립니다.
          </p>
          <button
            onClick={() => scrollTo("calendar")}
            className="mt-7 rounded-full bg-[var(--mint-bright)] px-7 py-3.5 text-sm font-semibold text-[var(--navy-deep)] transition hover:bg-white"
          >
            예약 가능일 확인하기
          </button>
        </div>
      </div>
    </section>
  );
}
