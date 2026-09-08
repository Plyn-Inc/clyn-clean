import type { CompanySettings } from "@/lib/settings";

export default function ContactSection({ company }: { company: CompanySettings }) {
  const telHref = company.phone ? `tel:${company.phone.replace(/-/g, "")}` : undefined;
  const smsHref = company.phone ? `sms:${company.phone.replace(/-/g, "")}` : undefined;

  return (
    <section id="contact" className="scroll-mt-24 bg-[var(--navy)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <p className="text-xs font-semibold tracking-wide text-[var(--mint-bright)]">문의하기</p>
        <h2 className="font-display mt-2 text-2xl font-bold text-white md:text-3xl">
          예약 전, 먼저 상담받고 싶다면
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#B8C0CE] md:text-base">
          예약하지 않고 상담이 필요한 경우, 아래 방법으로 편하게 문의해주세요.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <ContactButton
            label="전화 문의"
            sub={company.phone || "전화번호 등록 예정"}
            href={telHref}
            icon="📞"
          />
          <ContactButton
            label="문자 문의"
            sub={company.phone || "전화번호 등록 예정"}
            href={smsHref}
            icon="💬"
          />
          <ContactButton
            label="카카오톡 문의"
            sub="채팅으로 빠르게 상담"
            href={company.kakaoUrl || undefined}
            icon="🟡"
          />
        </div>

        <div className="mt-10 rounded-2xl bg-white/5 p-6 text-sm leading-relaxed text-[#B8C0CE]">
          <p className="mb-2 font-semibold text-white">문의 시 아래 정보를 함께 보내주시면 빠르게 안내드립니다</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            <li>· 청소 종류</li>
            <li>· 지역 또는 주소</li>
            <li>· 평수</li>
            <li>· 집 구조</li>
            <li>· 입주 전 / 퇴거 후 / 거주 중 여부</li>
            <li>· 희망 날짜</li>
            <li>· 추가사항 여부</li>
            <li>· 현장 사진</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function ContactButton({
  label,
  sub,
  href,
  icon,
}: {
  label: string;
  sub: string;
  href?: string;
  icon: string;
}) {
  const content = (
    <div className="flex h-full flex-col items-start gap-2 rounded-2xl border border-white/15 bg-white/5 p-6 transition hover:bg-white/10">
      <span className="text-2xl">{icon}</span>
      <p className="font-display font-bold text-white">{label}</p>
      <p className="text-xs text-[#8B95A6]">{sub}</p>
    </div>
  );

  if (!href) {
    return <div className="cursor-not-allowed opacity-70">{content}</div>;
  }

  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      {content}
    </a>
  );
}
