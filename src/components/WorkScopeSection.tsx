import { WORK_SCOPES } from "@/lib/work-scope-data";
import { SectionHeading } from "./ServiceList";

export default function WorkScopeSection() {
  return (
    <section className="bg-[var(--sand-deep)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionHeading
          eyebrow="작업 범위"
          title="공간별로 이렇게 작업합니다"
          desc="입주청소 기준 공간별 작업 범위입니다. 현장 상황에 따라 세부 항목은 조정될 수 있습니다."
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORK_SCOPES.map((scope) => (
            <div key={scope.space} className="rounded-2xl border border-[var(--line)] bg-white p-6">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="text-xl">{scope.icon}</span>
                <p className="font-display text-base font-bold">{scope.space}</p>
              </div>
              <ul className="space-y-1.5 text-sm text-[var(--ink-soft)]">
                {scope.tasks.map((task) => (
                  <li key={task} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--mint)]" />
                    {task}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 기본 제공 서비스 */}
        <div className="mt-12">
          <p className="mb-5 text-sm font-semibold text-[var(--mint)]">Clyn Clean 기본 제공 서비스</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: "🌿", title: "피톤치드 케어", desc: "천연 피톤치드로 공간을 정화합니다." },
              { icon: "♨️", title: "고온 스팀 위생케어", desc: "고온 스팀으로 주요 부위를 위생 처리합니다." },
              { icon: "✨", title: "유리막·발수 코팅", desc: "지정 부위에 유리막 또는 발수 코팅을 적용합니다." },
              { icon: "🔧", title: "배수구 실리콘 처리", desc: "필요 시 배수구 경미한 실리콘 처리를 진행합니다." },
              { icon: "💧", title: "배수구 악취 억제", desc: "배수구 악취를 억제 처리합니다." },
              { icon: "✅", title: "작업 완료 검수", desc: "작업 완료 후 꼼꼼하게 검수합니다." },
              { icon: "📋", title: "기본 AS", desc: "작업 후 기본 AS를 제공합니다." },
              { icon: "📸", title: "작업 전후 확인", desc: "작업 전후 사진 기록을 통해 결과를 확인합니다." },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="flex gap-3 rounded-xl border border-[var(--line)] bg-white p-4">
                <span className="text-xl shrink-0">{icon}</span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-soft)]">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
