const TRUST_POINTS = [
  { title: "작업 전 비용 안내", desc: "추가 작업이 필요하면 시작 전에 먼저 안내합니다." },
  { title: "추가비용 사전 동의", desc: "고객 동의 없이 추가 작업을 진행하지 않습니다." },
  { title: "작업 완료사진 제공", desc: "주요 작업 결과를 사진으로 확인할 수 있습니다." },
  { title: "청소범위 사전 확인", desc: "기본 포함범위와 별도 작업을 미리 구분합니다." },
];

export default function OneRoomTrustPoints() {
  return (
    <section className="bg-white py-10 md:py-12">
      <div className="mx-auto grid max-w-6xl gap-3 px-5 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
        {TRUST_POINTS.map((item) => (
          <div key={item.title} className="rounded-2xl border border-[var(--line)] p-5">
            <p className="font-display text-sm font-bold text-[var(--navy)]">✓ {item.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ink-soft)]">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
