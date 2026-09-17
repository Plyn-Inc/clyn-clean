"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BRAND_LOGO } from "@/lib/images";
import { sendMarketingEvent } from "@/lib/marketing-attribution";

export default function SiteHeader({ companyName, kakaoUrl = "" }: { companyName: string; kakaoUrl?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  if (pathname === "/one-room") {
    return (
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 md:px-8">
          <Link href="/" className="flex items-center" aria-label={companyName}>
            <Image
              src={BRAND_LOGO.src}
              alt={BRAND_LOGO.alt}
              width={BRAND_LOGO.width}
              height={BRAND_LOGO.height}
              priority
              sizes="(max-width: 768px) 120px, 148px"
              className="h-10 w-auto mix-blend-multiply md:h-12"
            />
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="#booking"
              onClick={() => void sendMarketingEvent("booking_started")}
              className="hidden min-h-[44px] items-center rounded-full bg-[var(--navy)] px-5 text-sm font-semibold text-white sm:flex"
            >
              견적 받기
            </a>
            <a
              href={kakaoUrl || "/consultation"}
              target={kakaoUrl ? "_blank" : undefined}
              rel={kakaoUrl ? "noreferrer" : undefined}
              onClick={() => void sendMarketingEvent("kakao_clicked")}
              className="flex min-h-[44px] items-center rounded-full border border-[var(--navy)] px-4 text-sm font-semibold text-[var(--navy)]"
            >
              카카오 문의
            </a>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--sand)]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 md:px-8">
        <Link href="/" className="flex items-center" aria-label={companyName}>
          <Image
            src={BRAND_LOGO.src}
            alt={BRAND_LOGO.alt}
            width={BRAND_LOGO.width}
            height={BRAND_LOGO.height}
            priority
            sizes="(max-width: 768px) 132px, 168px"
            className="h-11 w-auto mix-blend-multiply md:h-14"
          />
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-[var(--ink-soft)] md:flex">
          <Link href="/#calendar" className="hover:text-[var(--ink)]">예약 캘린더</Link>
          <Link href="/reservation" className="hover:text-[var(--ink)]">예약 조회</Link>
          <Link href="/#services" className="hover:text-[var(--ink)]">청소 서비스</Link>
          <Link href="/consultation" className="hover:text-[var(--ink)]">상담 접수</Link>
          <Link href="/#reviews" className="hover:text-[var(--ink)]">후기</Link>
          <Link href="/blog" className="hover:text-[var(--ink)]">블로그</Link>
          <Link href="/contact" className="hover:text-[var(--ink)]">문의하기</Link>
        </nav>

        <div className="hidden md:block">
          <Link
            href="/#booking"
            className="rounded-full bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)]"
          >
            바로 예약하기
          </Link>
        </div>

        <button
          aria-label="메뉴 열기"
          className="flex h-9 w-9 flex-col items-center justify-center gap-1.5 md:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`h-0.5 w-5 bg-[var(--ink)] transition ${open ? "translate-y-2 rotate-45" : ""}`} />
          <span className={`h-0.5 w-5 bg-[var(--ink)] transition ${open ? "opacity-0" : ""}`} />
          <span className={`h-0.5 w-5 bg-[var(--ink)] transition ${open ? "-translate-y-2 -rotate-45" : ""}`} />
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-[var(--line)] bg-[var(--sand)] px-5 py-4 text-sm font-medium text-[var(--ink-soft)] md:hidden">
          <Link href="/#calendar" className="rounded-lg px-3 py-2.5 hover:bg-[var(--sand-deep)]" onClick={() => setOpen(false)}>예약 캘린더</Link>
          <Link href="/reservation" className="rounded-lg px-3 py-2.5 hover:bg-[var(--sand-deep)]" onClick={() => setOpen(false)}>예약 조회</Link>
          <Link href="/#services" className="rounded-lg px-3 py-2.5 hover:bg-[var(--sand-deep)]" onClick={() => setOpen(false)}>청소 서비스</Link>
          <Link href="/consultation" className="rounded-lg px-3 py-2.5 hover:bg-[var(--sand-deep)]" onClick={() => setOpen(false)}>상담 접수</Link>
          <Link href="/#reviews" className="rounded-lg px-3 py-2.5 hover:bg-[var(--sand-deep)]" onClick={() => setOpen(false)}>후기</Link>
          <Link href="/blog" className="rounded-lg px-3 py-2.5 hover:bg-[var(--sand-deep)]" onClick={() => setOpen(false)}>블로그</Link>
          <Link href="/contact" className="rounded-lg px-3 py-2.5 hover:bg-[var(--sand-deep)]" onClick={() => setOpen(false)}>문의하기</Link>
          <Link
            href="/#booking"
            className="mt-2 rounded-full bg-[var(--navy)] px-5 py-2.5 text-center font-semibold text-white"
            onClick={() => setOpen(false)}
          >
            바로 예약하기
          </Link>
        </nav>
      )}
    </header>
  );
}
