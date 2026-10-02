"use client";

import { usePathname } from "next/navigation";
import { sendMarketingEvent } from "@/lib/marketing-attribution";

export default function FloatingKakaoChat({
  href,
  phone,
}: {
  href: string;
  phone: string;
}) {
  const pathname = usePathname();

  if (pathname.startsWith("/admin") || (!href && !phone)) {
    return null;
  }

  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, "")}` : undefined;
  const oneRoomDesktopOnly = pathname === "/one-room" ? "hidden md:flex" : "flex";

  return (
    <div
      className={`fixed bottom-5 right-4 z-[60] ${oneRoomDesktopOnly} flex-col items-end gap-2 sm:bottom-6 sm:right-6`}
      aria-label="빠른 문의"
    >
      {telHref && (
        <a
          href={telHref}
          aria-label={`전화 문의 ${phone}`}
          title={`전화 문의 ${phone}`}
          onClick={() => void sendMarketingEvent("phone_clicked")}
          className="flex min-h-[52px] items-center gap-2.5 rounded-full bg-[var(--navy)] px-3.5 py-2.5 text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[var(--navy-deep)] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navy)] focus-visible:ring-offset-2 sm:px-4"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M6.62 10.79a15.46 15.46 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z" />
            </svg>
          </span>
          <span className="flex flex-col text-left leading-tight">
            <span className="text-sm font-bold">전화 문의</span>
            <span className="mt-0.5 hidden text-[10px] font-medium text-white/75 sm:block">{phone}</span>
          </span>
        </a>
      )}

      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="카카오톡 1:1 상담 열기"
          title="카카오톡 상담 (매일 09:00~21:00)"
          onClick={() => void sendMarketingEvent("kakao_clicked")}
          className="flex min-h-[52px] items-center gap-2.5 rounded-full border border-black/10 bg-[#FEE500] px-3.5 py-2.5 text-[#191919] shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#191919] focus-visible:ring-offset-2 sm:px-4"
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
      )}
    </div>
  );
}
