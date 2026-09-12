import { SERVICE_TYPES, serviceLabel } from "@/lib/types";

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  "입주청소": "새로운 공간에 입주하기 전 집 전체를 꼼꼼하게 관리하는 기본 청소 서비스입니다.",
  "사이청소": "기존 거주자가 나간 뒤 새 입주자가 같은 날 들어오는 경우, 퇴거와 입주 사이 시간에 진행하는 청소입니다.",
  "거주청소": "현재 생활 중인 공간의 생활오염을 집중 관리하는 청소 서비스입니다.",
  "집정리": "옷·생활용품·주방·팬트리 등 생활공간을 인원·시간 기준으로 정리하는 서비스입니다.",
};

export default function ServiceList() {
  return (
    <section id="services" className="scroll-mt-24 bg-[var(--sand)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="청소 서비스"
          title="청소 서비스 구분"
          desc="공간의 상태와 이용 상황에 따라 제공되는 청소 서비스의 구분을 안내드립니다."
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICE_TYPES.map((service) => (
            <div
              key={service}
              className="rounded-2xl border border-[var(--line)] bg-white p-6 transition hover:border-[var(--mint)] hover:shadow-sm"
            >
              <p className="font-display text-base font-bold">{serviceLabel(service)}</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                {SERVICE_DESCRIPTIONS[service] || ""}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-[var(--mint)]">{eyebrow}</p>
      <h2 className="font-display mt-2 text-2xl font-bold md:text-3xl">{title}</h2>
      {desc && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-soft)] md:text-base">{desc}</p>}
    </div>
  );
}
