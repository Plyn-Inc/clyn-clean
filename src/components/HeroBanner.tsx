"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { HERO_SLIDES } from "@/lib/images";
import OneRoomOfferPrice from "@/components/OneRoomOfferPrice";

/**
 * 메인 Hero.
 *
 * 브랜드 사이트의 정체성은 유지하되 현재 주력상품인 일반 단층 원룸을 가장 먼저 판매한다.
 * 가격은 공개 offer API에서 가져와 실제 자동 프로모션 결과와 일치시킨다.
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

      <div
        className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/78 to-white/15 md:to-transparent"
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <p className="mb-3 inline-block rounded-full bg-[var(--mint-soft)] px-4 py-1.5 text-xs font-semibold tracking-wide text-[var(--mint)]">
          일반 단층 원룸 전용 온라인 예약
        </p>
        <h1 className="font-display max-w-3xl text-4xl font-bold leading-tight text-[var(--navy)] md:text-6xl">
          원룸 입주·퇴실청소
          <br />
          복잡하게 견적받지 마세요.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--ink-soft)] md:text-lg">
          작업 전 추가비용을 먼저 안내하고, 작업 완료 후 주요 결과사진을 제공합니다.
        </p>

        <div className="mt-7">
          <p className="mb-1 text-xs font-bold tracking-[0.16em] text-[var(--mint)]">CLYN OPEN PRICE</p>
          <OneRoomOfferPrice showLabel={false} />
        </div>
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-[var(--ink-soft)]">
          일반 단층 원룸 기본 청소범위 기준 · 1.5룸 · 원룸 복층 · 투룸 이상 제외 · 특수오염·폐기물·별도 요청 작업은 작업 전 안내 후 진행
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={() => scrollTo("calendar")}
            className="min-h-[52px] rounded-full bg-[var(--navy)] px-7 text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)]"
          >
            예약 가능일 확인
          </button>
          <button
            onClick={() => scrollTo("booking")}
            className="min-h-[52px] rounded-full border border-[var(--navy)] bg-white/80 px-7 text-sm font-semibold text-[var(--navy)] backdrop-blur transition hover:bg-white"
          >
            빠른 견적 받기
          </button>
          {kakaoUrl ? (
            <a
              href={kakaoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[52px] items-center rounded-full border border-[var(--line)] bg-white/80 px-7 text-sm font-semibold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white"
            >
              카카오톡 문의
            </a>
          ) : (
            <a
              href="/consultation"
              className="flex min-h-[52px] items-center rounded-full border border-[var(--line)] bg-white/80 px-7 text-sm font-semibold text-[var(--ink-soft)] backdrop-blur transition hover:bg-white"
            >
              상담 접수
            </a>
          )}
        </div>

        {phone && <p className="mt-5 text-sm text-[var(--ink-soft)]">전화 문의 {phone}</p>}

        <div className="mt-8 flex gap-2" role="tablist" aria-label="대표 이미지 선택">
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
