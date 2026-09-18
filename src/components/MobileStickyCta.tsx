"use client";

import { sendMarketingEvent } from "@/lib/marketing-attribution";

export default function MobileStickyCta({ kakaoUrl }: { kakaoUrl: string }) {
  function scrollBooking() {
    void sendMarketingEvent("booking_started");
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-white/95 p-3 md:hidden">
      <div className="mx-auto grid max-w-xl grid-cols-2 gap-2">
        <button onClick={scrollBooking} className="min-h-[48px] rounded-full bg-[var(--navy)] px-4 text-sm font-semibold text-white">견적 받기</button>
        <a
          href={kakaoUrl || "/consultation"}
          target={kakaoUrl ? "_blank" : undefined}
          rel={kakaoUrl ? "noreferrer" : undefined}
          onClick={() => void sendMarketingEvent("kakao_clicked")}
          className="flex min-h-[48px] items-center justify-center rounded-full border border-[var(--navy)] px-4 text-sm font-semibold text-[var(--navy)]"
        >
          카카오톡 문의
        </a>
      </div>
    </div>
  );
}
