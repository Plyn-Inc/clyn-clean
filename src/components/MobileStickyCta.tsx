"use client";

import { sendMarketingEvent } from "@/lib/marketing-attribution";

export default function MobileStickyCta({
  kakaoUrl,
  phone,
}: {
  kakaoUrl: string;
  phone: string;
}) {
  function scrollBooking() {
    void sendMarketingEvent("booking_started");
    document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, "")}` : undefined;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--line)] bg-white/95 p-3 md:hidden">
      <div className="mx-auto grid max-w-xl grid-cols-3 gap-2">
        <button
          onClick={scrollBooking}
          className="min-h-[48px] rounded-full bg-[var(--navy)] px-2 text-sm font-semibold text-white"
        >
          견적 받기
        </button>
        <a
          href={telHref || "#"}
          onClick={() => void sendMarketingEvent("phone_clicked")}
          className="flex min-h-[48px] items-center justify-center rounded-full border border-[var(--navy)] px-2 text-sm font-semibold text-[var(--navy)]"
          aria-label={phone ? `전화 문의 ${phone}` : "전화 문의"}
        >
          전화 문의
        </a>
        <a
          href={kakaoUrl || "/consultation"}
          target={kakaoUrl ? "_blank" : undefined}
          rel={kakaoUrl ? "noreferrer" : undefined}
          onClick={() => void sendMarketingEvent("kakao_clicked")}
          className="flex min-h-[48px] items-center justify-center rounded-full border border-[var(--navy)] px-2 text-sm font-semibold text-[var(--navy)]"
        >
          카카오톡
        </a>
      </div>
    </div>
  );
}
