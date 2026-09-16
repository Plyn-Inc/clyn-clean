import OneRoomOfferPrice from "@/components/OneRoomOfferPrice";

export default function OneRoomOfferSection() {
  return (
    <section className="bg-white py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="grid gap-8 rounded-3xl border border-[var(--line)] bg-[var(--sand)] p-6 md:grid-cols-[1.1fr_0.9fr] md:p-10">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-[var(--mint)]">현재 주력상품</p>
            <h2 className="font-display mt-2 text-3xl font-bold text-[var(--navy)] md:text-4xl">
              일반 원룸 입주·퇴실청소
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--ink-soft)]">
              일반 단층 원룸과 단층 오피스텔형 원룸을 대상으로 온라인 예약을 운영합니다.
              가능한 날짜와 최종 예약가격은 예약 단계에서 다시 확인할 수 있습니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-xs font-semibold text-[var(--navy)]">
              <span className="rounded-full bg-white px-3 py-2">일반 원룸</span>
              <span className="rounded-full bg-white px-3 py-2">단층 오피스텔형 원룸</span>
              <span className="rounded-full bg-white px-3 py-2">입주 전</span>
              <span className="rounded-full bg-white px-3 py-2">퇴거 후</span>
            </div>
          </div>
          <div className="flex flex-col justify-center rounded-2xl bg-white p-6">
            <OneRoomOfferPrice />
            <p className="mt-4 text-xs leading-relaxed text-[var(--ink-soft)]">
              1.5룸 · 원룸 복층 · 투룸 이상은 이 온라인 원룸 상품 대상에서 제외됩니다.
              특수오염·폐기물·별도 요청 작업은 작업 전 안내 후 진행합니다.
            </p>
            <a
              href="#calendar"
              className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-full bg-[var(--navy)] px-6 text-sm font-semibold text-white"
            >
              예약 가능한 날짜 보기
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
