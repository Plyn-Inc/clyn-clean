"use client";

import Image from "next/image";
import OneRoomOfferPrice from "@/components/OneRoomOfferPrice";
import { HERO_SLIDES } from "@/lib/images";

export default function OneRoomLandingHero() {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="relative overflow-hidden bg-white">
      <Image src={HERO_SLIDES[0].src} alt={HERO_SLIDES[0].alt} fill priority sizes="100vw" className="object-cover object-center" />
      <div className="absolute inset-0 bg-gradient-to-r from-white/95 via-white/80 to-white/20" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <p className="text-sm font-semibold text-[var(--mint)]">일반 단층 원룸 전용 온라인 예약</p>
        <h1 className="font-display mt-3 max-w-3xl text-4xl font-bold leading-tight text-[var(--navy)] md:text-6xl">
          원룸 입주·퇴실청소
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--ink-soft)] md:text-lg">
          복잡한 견적 과정 없이 가능한 날짜와 실제 예약가격을 바로 확인하세요.
        </p>
        <div className="mt-7"><OneRoomOfferPrice /></div>
        <p className="mt-4 max-w-xl text-xs leading-relaxed text-[var(--ink-soft)]">
          일반 단층 원룸 기본 청소범위 기준 · 1.5룸 · 원룸 복층 · 투룸 이상 제외 · 특수오염 및 별도 요청 작업은 사전 안내 후 진행
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button onClick={() => scrollTo("calendar")} className="min-h-[52px] rounded-full bg-[var(--navy)] px-7 text-sm font-semibold text-white">예약 가능일 확인</button>
          <button onClick={() => scrollTo("booking")} className="min-h-[52px] rounded-full border border-[var(--navy)] bg-white/80 px-7 text-sm font-semibold text-[var(--navy)]">빠른 견적 받기</button>
        </div>
      </div>
    </section>
  );
}
