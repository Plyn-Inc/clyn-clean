"use client";

export default function HeroBanner({ kakaoUrl, phone }: { kakaoUrl: string; phone: string }) {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="relative overflow-hidden bg-[var(--navy)]">
      <div className="absolute inset-0 opacity-[0.07]" aria-hidden>
        <CalendarGridDecoration />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <p className="mb-4 inline-block rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold tracking-wide text-[var(--mint-bright)]">
          예약 가능 날짜 실시간 확인
        </p>
        <h1 className="font-display max-w-3xl text-3xl font-bold leading-tight text-white md:text-5xl">
          입주청소 예약 가능 날짜를
          <br />
          바로 확인하세요
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-[#B8C0CE] md:text-lg">
          캘린더에서 가능한 날짜를 선택하거나, 바로 예약하기를 통해 예약을 진행할 수 있습니다.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <button
            onClick={() => scrollTo("calendar")}
            className="rounded-full bg-[var(--mint-bright)] px-6 py-3.5 text-sm font-semibold text-[var(--navy-deep)] transition hover:bg-white"
          >
            예약 가능 날짜 보기
          </button>
          <button
            onClick={() => scrollTo("booking")}
            className="rounded-full border border-white/30 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15"
          >
            바로 예약하기
          </button>
          {kakaoUrl ? (
            <a
              href={kakaoUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/30 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              상담 문의
            </a>
          ) : (
            <button
              onClick={() => scrollTo("contact")}
              className="rounded-full border border-white/30 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              상담 문의
            </button>
          )}
        </div>

        {phone && <p className="mt-6 text-sm text-[#8B95A6]">전화 문의 {phone}</p>}
      </div>
    </section>
  );
}

function CalendarGridDecoration() {
  const cells = Array.from({ length: 42 });
  return (
    <div className="grid h-full grid-cols-7 gap-3 p-10">
      {cells.map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-white/40"
          style={{ opacity: (i % 7 === 2 || i % 11 === 0) ? 0.9 : 0.25 }}
        />
      ))}
    </div>
  );
}
