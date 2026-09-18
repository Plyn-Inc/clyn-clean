"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { HERO_SLIDES } from "@/lib/images";
import OneRoomOfferPrice from "@/components/OneRoomOfferPrice";
import BookingSection from "@/components/booking/BookingSection";
import type { OneRoomOffer } from "@/lib/offers";

/**
 * 메인 Hero.
 * 데스크톱은 판매 메시지 42% / 예약 58%로 배치하고,
 * 우측 예약영역은 날짜 선택 전 캘린더, 선택 후 예약폼으로 전환한다.
 */
export default function HeroBanner({ kakaoUrl, phone, offer }: { kakaoUrl: string; phone: string; offer: OneRoomOffer | null }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % HERO_SLIDES.length), 6000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="relative overflow-hidden bg-white">
      {HERO_SLIDES.map((slide, i) => (
        <Image
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          fill
          fetchPriority={i === 0 ? "high" : "low"}
          loading={i === 0 ? "eager" : "lazy"}
          sizes="100vw"
          className={`object-cover object-center transition-opacity duration-1000 ${i === index ? "opacity-100" : "opacity-0"}`}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/88 to-white/55" aria-hidden />

      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8 md:px-8 lg:py-10">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:gap-7">
          <div className="pt-1 lg:pt-5">
            <p className="mb-3 inline-block rounded-full bg-[var(--mint-soft)] px-4 py-1.5 text-xs font-semibold tracking-wide text-[var(--mint)]">
              일반 단층 원룸 전용 온라인 예약
            </p>
            <h1 className="font-display text-3xl font-bold leading-tight text-[var(--navy)] sm:text-4xl lg:text-[2rem] xl:text-[2.7rem]">
              원룸 입주·퇴실청소
              <br />
              복잡하게 견적받지 마세요.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--ink-soft)] sm:text-base lg:text-lg">
              작업 전 추가비용을 먼저 안내하고, 작업 완료 후 주요 결과사진을 제공합니다.
            </p>

            <div className="mt-5 rounded-2xl border border-white/70 bg-white/88 p-4 shadow-sm backdrop-blur sm:inline-block sm:min-w-[360px]">
              <p className="mb-1 text-xs font-bold tracking-[0.16em] text-[var(--mint)]">CLYN OPEN PRICE</p>
              <OneRoomOfferPrice showLabel={false} initialOffer={offer} />
            </div>
            <p className="mt-3 max-w-xl text-[11px] leading-relaxed text-[var(--ink-soft)] sm:text-xs">
              일반 단층 원룸 기본 청소범위 기준 · 1.5룸 · 원룸 복층 · 투룸 이상 제외 · 특수오염·폐기물·별도 요청 작업은 작업 전 안내 후 진행
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {kakaoUrl ? (
                <a href={kakaoUrl} target="_blank" rel="noreferrer" className="flex min-h-[48px] items-center rounded-full border border-[var(--navy)] bg-white/90 px-5 text-sm font-semibold text-[var(--navy)]">
                  카카오톡 문의
                </a>
              ) : (
                <a href="/consultation" className="flex min-h-[48px] items-center rounded-full border border-[var(--navy)] bg-white/90 px-5 text-sm font-semibold text-[var(--navy)]">
                  상담 접수
                </a>
              )}
              {phone && <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className="flex min-h-[48px] items-center rounded-full bg-[var(--navy)] px-5 text-sm font-semibold text-white">전화 문의</a>}
            </div>

            <div className="mt-5 flex gap-2" role="tablist" aria-label="대표 이미지 선택">
              {HERO_SLIDES.map((slide, i) => (
                <button key={slide.src} role="tab" aria-selected={i === index} aria-label={`${i + 1}번째 이미지: ${slide.alt}`} onClick={() => setIndex(i)} className={`h-2.5 rounded-full transition-all ${i === index ? "w-8 bg-[var(--navy)]" : "w-2.5 bg-[var(--navy)]/25"}`} />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/80 bg-white/94 p-2.5 shadow-xl backdrop-blur sm:p-3 lg:p-4">
            <BookingSection mode="one-room" layout="hero" />
          </div>
        </div>
      </div>
    </section>
  );
}
