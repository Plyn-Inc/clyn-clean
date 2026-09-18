"use client";

import { useEffect, useState } from "react";

type Offer = {
  basePrice: number;
  openPrice: number;
  discountAmount: number;
  promotionName: string | null;
};

let sharedOfferPromise: Promise<Offer> | null = null;

function loadOfferOnce(): Promise<Offer> {
  sharedOfferPromise ??= fetch("/api/offers/one-room")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("offer fetch failed")))
    .catch((error) => {
      sharedOfferPromise = null;
      throw error;
    });
  return sharedOfferPromise;
}

export default function OneRoomOfferPrice({ compact = false, showLabel = true }: { compact?: boolean; showLabel?: boolean }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadOfferOnce()
      .then((data) => {
        if (!cancelled) setOffer(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, []);

  if (!offer) {
    return (
      <div aria-live="polite">
        {showLabel && <p className="text-xs font-bold tracking-[0.16em] text-[var(--mint)]">CLYN OPEN PRICE</p>}
        <p className={`${compact ? "text-2xl" : "text-4xl md:text-5xl"} mt-1 font-display font-bold text-[var(--navy)]`}>
          {failed ? "예약에서 최종 가격 확인" : "가격 확인 중"}
        </p>
      </div>
    );
  }

  return (
    <div aria-live="polite">
      {showLabel && <p className="text-xs font-bold tracking-[0.16em] text-[var(--mint)]">CLYN OPEN PRICE</p>}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {offer.discountAmount > 0 && (
          <p className={`${compact ? "text-base" : "text-lg md:text-xl"} font-extrabold text-[#D14343] line-through decoration-[#D14343] decoration-4`}>
            {offer.basePrice.toLocaleString("ko-KR")}원
          </p>
        )}
        <p className={`${compact ? "text-2xl" : "text-4xl md:text-5xl"} font-display font-bold text-[var(--navy)]`}>
          {offer.openPrice.toLocaleString("ko-KR")}원
        </p>
      </div>
      {offer.discountAmount > 0 && (
        <p className="mt-1 text-xs text-[var(--ink-soft)]">
          현재 활성 오픈 프로모션이 자동 적용된 가격입니다.
        </p>
      )}
    </div>
  );
}
