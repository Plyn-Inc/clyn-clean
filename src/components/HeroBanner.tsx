"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { HERO_SLIDES } from "@/lib/images";

/**
 * Hero — 제공된 2장을 모두 사용하는 fade carousel.
 *
 * - 약 6초 자동 전환, 수동 dot 제공, 키보드 접근 가능
 * - prefers-reduced-motion: reduce 에서는 자동 전환을 멈춘다
 * - 사진의 밝기가 살아나도록 어두운 전면 오버레이를 쓰지 않고
 *   텍스트 영역에만 약한 그라데이션을 적용한다
 */
export default function HeroBanner({ kakaoUrl, phone }: { kakaoUrl: string; phone: string }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="relative overflow-hidden bg-white">
      {HERO_SLIDES.map((slide, i) => (
        <Image
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          fill
          priority={i === 0}
          sizes="100vw"
          className={`object-cover object-center transition-opacity duration-1000 ${
            i === index ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      {/* 텍스트 영역에만 약한 그라데이션 — 사진 밝기를 유지한다 */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-white/92 via-white/70 to-white/10 md:to-transparent"
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-5 py-24 md:px-8 md:py-32">
        <p className="mb-4 inline-block rounded-full bg-[var(--mint-soft)] px-4 py-1.5 text-xs font-semibold tracking-wide text-[var(--mint)]">
          예약 가능 날짜 실시간 확인
        </p>
        <h1 className="font-display max-w-3xl text-3xl font-bold leading-tight text-[var(--navy)] md:text-5xl">
          입주청소 예약 가능 날짜를
          <br />
          바로 확인하세요
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--ink-soft)] md:text-lg">
          캘린더에서 가능한 날짜를 선택하거나, 바로 예약하기를 통해 예약을 진행할 수 있습니다.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <button
            onClick={() => scrollTo("calendar")}
            className="min-h-[52px] rounded-full bg-[var(--navy)] px-7 text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)]"
          >
            예약 가능 날짜 보기
          </button>
          <button
            onClick={() => scrollTo("booking")}
            className="min-h-[52px] rounded-full border border-[var(--navy)] bg-white/70 px-7 text-sm font-semibold text-[var(--navy)] backdrop-blur transition hover:bg-white"
          >
            바로 예약하기
          </button>
          {kakaoUrl ? (
            <a
              href={kakaoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[52px] items-center rounded-full border border-[var(--line)] bg-white/70 px-7 text-sm font-semibold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white"
            >
              상담 문의
            </a>
          ) : (
            <a
              href="/consultation"
              className="flex min-h-[52px] items-center rounded-full border border-[var(--line)] bg-white/70 px-7 text-sm font-semibold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white"
            >
              상담 접수
            </a>
          )}
        </div>

        {phone && <p className="mt-6 text-sm text-[var(--ink-soft)]">전화 문의 {phone}</p>}

        {/* 슬라이드 인디케이터 — 키보드 접근 가능 */}
        <div className="mt-9 flex gap-2" role="tablist" aria-label="대표 이미지 선택">
          {HERO_SLIDES.map((slide, i) => (
            <button
              key={slide.src}
              role="tab"
              aria-selected={i === index}
              aria-label={`${i + 1}번째 이미지: ${slide.alt}`}
              onClick={() => setIndex(i)}
              className={`h-2.5 rounded-full transition-all ${
                i === index ? "w-8 bg-[var(--navy)]" : "w-2.5 bg-[var(--navy)]/25"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
