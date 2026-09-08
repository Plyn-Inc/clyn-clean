export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  robots: { index: false },
};

export default async function PrivacyPage() {
  const [companyNameRaw, companyPhoneRaw, bizNumberRaw, customContent] = await Promise.all([
    getSetting("company_name"),
    getSetting("company_phone"),
    getSetting("company_biz_number"),
    getSetting("privacy_policy_content"),
  ]);
  const companyName = companyNameRaw || "[회사명]";
  const companyPhone = companyPhoneRaw || "[연락처]";
  const bizNumber = bizNumberRaw || "[사업자등록번호]";

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold">개인정보처리방침</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">최종 수정일: 관리자 설정 필요</p>

      {customContent ? (
        <div className="prose prose-neutral mt-8 max-w-none whitespace-pre-wrap text-sm leading-relaxed">
          {customContent}
        </div>
      ) : (
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-[var(--ink)]">
          <Notice />

          <Section title="1. 개인정보 수집 항목 및 목적">
            <p><strong>[필수]</strong> 이름, 연락처, 지역/주소: 예약 서비스 제공 및 고객 확인</p>
            <p><strong>[선택]</strong> 이메일: 예약 확인 이메일 발송</p>
          </Section>

          <Section title="2. 개인정보 보유 및 이용기간">
            <p>수집된 개인정보는 서비스 이용 계약 종료 후 1년간 보관 후 파기합니다.</p>
            <p>단, 관련 법령에 따라 일정 기간 보관이 필요한 경우 해당 기간 동안 보관합니다.</p>
          </Section>

          <Section title="3. 개인정보의 제3자 제공">
            <p>{companyName}은(는) 원칙적으로 이용자의 개인정보를 외부에 제공하지 않습니다.</p>
            <p>단, 이용자가 동의하거나 법령에 따라 제공이 요구되는 경우에는 예외로 합니다.</p>
          </Section>

          <Section title="4. 개인정보처리 위탁">
            <p>현재 개인정보처리 업무를 위탁하는 외부 업체가 없습니다.</p>
          </Section>

          <Section title="5. 정보주체의 권리">
            <p>이용자는 언제든지 다음 권리를 행사할 수 있습니다.</p>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>개인정보 열람 요청</li>
              <li>오류 정정 요청</li>
              <li>삭제 요청</li>
              <li>처리정지 요청</li>
            </ul>
          </Section>

          <Section title="6. 개인정보 파기">
            <p>개인정보는 보유기간 경과 또는 처리목적 달성 시 지체 없이 파기합니다.</p>
          </Section>

          <Section title="7. 개인정보 보호책임자 및 문의처">
            <p>회사명: {companyName}</p>
            <p>사업자등록번호: {bizNumber}</p>
            <p>연락처: {companyPhone}</p>
          </Section>

          <div className="rounded-xl bg-[#FBE9D3] px-4 py-3 text-xs text-[var(--amber)]">
            ※ 이 개인정보처리방침은 관리자 설정 페이지에서 직접 내용을 입력하면 커스텀 내용으로 교체됩니다.
            실제 운영 전 법률 전문가의 검토를 받으시기 바랍니다.
          </div>
        </div>
      )}
    </div>
  );
}

function Notice() {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--sand-deep)] px-4 py-3 text-xs text-[var(--ink-soft)]">
      이 방침은 예약 서비스 운영을 위한 최소한의 개인정보 처리 방침입니다.
      실제 운영 시 법률 전문가의 검토를 받아 수정하시기 바랍니다.
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-semibold text-base mb-2">{title}</h2>
      <div className="space-y-1 text-[var(--ink-soft)]">{children}</div>
    </div>
  );
}
