import { SectionHeading } from "@/components/ServiceList";

const INCLUDED = ["주방", "욕실", "창틀", "수납장", "바닥", "현관", "몰딩", "기본 먼지·오염 제거"];
const EXTRA = ["심한 곰팡이", "스티커·본드 제거", "폐기물", "심한 니코틴", "특수 오염", "가전 내부청소", "계약범위 외 추가작업"];

export default function OneRoomScope() {
  return (
    <section className="bg-[var(--sand-deep)] py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="원룸 청소범위"
          title="포함되는 작업과 별도 확인 작업을 미리 구분합니다"
          desc="현장에서 예상치 못한 비용이 생기지 않도록 기본범위와 별도 작업 기준을 먼저 안내합니다."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <ScopeCard title="기본 포함" items={INCLUDED} />
          <ScopeCard title="별도 확인" items={EXTRA} warning />
        </div>
        <p className="mt-5 rounded-xl bg-white px-5 py-4 text-sm leading-relaxed text-[var(--ink-soft)]">
          별도 작업이 필요한 경우 작업 전에 내용과 금액을 안내하고 고객 동의를 받은 후 진행합니다.
        </p>
      </div>
    </section>
  );
}

function ScopeCard({ title, items, warning }: { title: string; items: string[]; warning?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-6">
      <p className={`font-display text-lg font-bold ${warning ? "text-[var(--rose)]" : "text-[var(--navy)]"}`}>{title}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-[var(--ink-soft)]">
            <span className="text-[var(--mint)]">•</span>{item}
          </li>
        ))}
      </ul>
    </div>
  );
}
