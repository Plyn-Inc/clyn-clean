"use client";

import { usePathname } from "next/navigation";
import { sendMarketingEvent } from "@/lib/marketing-attribution";

export default function FloatingKakaoChat({ href }: { href: string }) {
  const pathname = usePathname();

  if (!href || pathname.startsWith("/admin") || pathname === "/one-room") {
    return null;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="카카오톡 1:1 상담 열기"
      title="카카오톡 상담 (매일 09:00~21:00)"
      onClick={() => void sendMarketingEvent("kakao_clicked")}
      className="fixed bottom-5 right-4 z-[60] flex min-h-[52px] items-center gap-2.5 rounded-full border border-black/10 bg-[#FEE500] px-3.5 py-2.5 text-[#191919] shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#191919] focus-visible:ring-offset-2 sm:bottom-6 sm:right-6 sm:px-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#191919] text-[#FEE500]" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M12 3.5c-5.52 0-10 3.47-10 7.75 0 2.7 1.8 5.08 4.54 6.47l-.92 3.39c-.08.3.27.54.53.36l3.96-2.64c.61.11 1.24.17 1.89.17 5.52 0 10-3.47 10-7.75S17.52 3.5 12 3.5Z" />
        </svg>
      </span>
      <span className="flex flex-col text-left leading-tight">
        <span className="text-sm font-bold">카카오톡 상담</span>
        <span className="mt-0.5 hidden text-[10px] font-medium text-black/60 sm:block">
          매일 09:00~21:00
        </span>
      </span>
    </a>
  );
}
