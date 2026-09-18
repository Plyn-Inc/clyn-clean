type Offer = {
  basePrice: number;
  openPrice: number;
  discountAmount: number;
  promotionName: string | null;
};

export default function OneRoomOfferPrice({
  compact = false,
  showLabel = true,
  initialOffer,
}: {
  compact?: boolean;
  showLabel?: boolean;
  initialOffer: Offer | null;
}) {
  const offer = initialOffer;

  if (!offer) {
    return (
      <div>
        {showLabel && <p className="text-xs font-bold tracking-[0.16em] text-[var(--mint)]">CLYN OPEN PRICE</p>}
        <p className={`${compact ? "text-2xl" : "text-4xl md:text-5xl"} mt-1 font-display font-bold text-[var(--navy)]`}>
          예약에서 최종 가격 확인
        </p>
      </div>
    );
  }

  return (
    <div>
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
