export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCompanySettingsSafe } from "@/lib/settings";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  alternates: { canonical: "/privacy" },
};

export default async function PrivacyPage() {
  const company = await getCompanySettingsSafe();
  const operator = company.legalCompanyName || company.name;
  const effectiveDate = "2026년 9월 18일";

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold">개인정보처리방침</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">시행일: {effectiveDate}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-[var(--ink)]">
        <Intro>
          {operator}(이하 “회사”)는 CLYN CLEAN CARE 서비스 이용자의 개인정보를 중요하게 생각하며, 개인정보 보호 관련 법령을 준수합니다. 회사는 개인정보의 처리 목적, 항목 및 보호조치를 다음과 같이 공개합니다.
        </Intro>

        <Section title="1. 개인정보의 처리 목적">
          <p>회사는 다음 목적을 위해 필요한 범위에서 개인정보를 처리합니다.</p>
          <ul>
            <li>• 청소 및 관련 서비스의 견적, 예약 접수, 예약 확인 및 일정 관리</li>
            <li>• 고객 본인 확인 및 서비스 장소 확인</li>
            <li>• 예약 선금 및 결제 확인, 서비스 제공 및 사후 처리</li>
            <li>• 예약·결제·서비스 진행과 관련한 알림톡 또는 문자 안내</li>
            <li>• 고객 문의, 불만 및 분쟁 처리</li>
          </ul>
        </Section>

        <Section title="2. 처리하는 개인정보의 항목">
          <p><strong>필수항목:</strong> 예약자명, 휴대전화번호, 작업 지역 및 상세주소, 서비스 종류, 주택유형·면적 등 견적에 필요한 정보, 희망 작업일 및 시간대, 예약·결제 관련 정보</p>
          <p><strong>선택항목:</strong> 기타 요청사항 등 이용자가 서비스 제공을 위해 추가로 입력한 정보</p>
          <p>서비스 이용 과정에서 접속기록, IP 주소, 기기·브라우저 정보 등 통상적인 웹 이용정보가 자동으로 생성될 수 있습니다.</p>
        </Section>

        <Section title="3. 개인정보의 보유 및 이용기간">
          <p>회사는 개인정보의 처리 목적이 달성되면 지체 없이 파기하는 것을 원칙으로 합니다. 다만 관계 법령에 따라 보존할 필요가 있는 경우에는 해당 법령에서 정한 기간 동안 보관합니다.</p>
          <ul>
            <li>• 계약 또는 청약철회 등에 관한 기록: 5년</li>
            <li>• 대금결제 및 서비스 공급에 관한 기록: 5년</li>
            <li>• 소비자 불만 또는 분쟁처리에 관한 기록: 3년</li>
          </ul>
        </Section>

        <Section title="4. 개인정보의 제3자 제공">
          <p>회사는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다.</p>
          <p>다만 이용자가 별도로 동의한 경우 또는 법령에 특별한 규정이 있는 경우에는 필요한 범위에서 제공할 수 있습니다.</p>
        </Section>

        <Section title="5. 개인정보 처리위탁">
          <p>회사는 원활한 예약 안내 및 서비스 운영을 위해 필요한 업무의 일부를 외부 서비스에 위탁할 수 있습니다.</p>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full min-w-[520px] border-collapse text-left text-xs">
              <thead><tr><Th>수탁 서비스</Th><Th>위탁 업무</Th><Th>처리 정보</Th></tr></thead>
              <tbody>
                <tr><Td>솔라피(SOLAPI)</Td><Td>카카오 알림톡 및 SMS 발송</Td><Td>휴대전화번호 및 예약 안내에 필요한 정보</Td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2">회사는 위탁계약 또는 서비스 이용관계에서 개인정보가 안전하게 처리되도록 필요한 사항을 관리·감독합니다.</p>
        </Section>

        <Section title="6. 개인정보의 파기 절차 및 방법">
          <p>보유기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다.</p>
          <p>전자적 파일은 복구 또는 재생이 어렵도록 안전한 방법으로 삭제하고, 종이 문서는 분쇄 또는 소각 등의 방법으로 파기합니다.</p>
        </Section>

        <Section title="7. 정보주체의 권리와 행사방법">
          <p>이용자는 회사에 자신의 개인정보에 대한 열람, 정정·삭제, 처리정지 및 동의 철회를 요청할 수 있습니다.</p>
          <p>권리 행사는 아래 연락처를 통해 요청할 수 있으며, 회사는 본인 여부를 확인한 후 관계 법령에 따라 지체 없이 처리합니다.</p>
        </Section>

        <Section title="8. 개인정보의 안전성 확보조치">
          <p>회사는 개인정보 보호를 위해 접근권한 관리, 인증정보 보호, 전송구간 보호, 접근기록 관리 등 서비스 규모와 처리 정보에 맞는 기술적·관리적 보호조치를 시행합니다.</p>
        </Section>

        <Section title="9. 개인정보 보호책임 및 문의">
          <p>개인정보 처리와 관련한 문의, 불만 또는 권리 행사는 아래 연락처로 요청할 수 있습니다.</p>
          <p>개인정보 보호책임 부서: CLYN CLEAN CARE 운영팀</p>
          <p>운영주체: {operator}</p>
          <p>연락처: {company.phone}</p>
          <p>주소: {company.address}</p>
        </Section>

        <Section title="10. 개인정보 처리방침의 변경">
          <p>본 개인정보처리방침의 내용이 변경되는 경우 회사는 변경사항을 홈페이지를 통해 공개합니다.</p>
          <p>본 방침은 {effectiveDate}부터 시행합니다.</p>
        </Section>

        <Section title="사업자 정보">
          <p>운영주체: {operator}</p>
          <p>브랜드: {company.brandName}</p>
          <p>사업자등록번호: {company.bizNumber}</p>
          <p>통신판매업 신고번호: {company.mailOrderNumber}</p>
          <p>연락처: {company.phone}</p>
        </Section>
      </div>
    </div>
  );
}

function Intro({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--line)] bg-[var(--sand-deep)] px-4 py-4 text-[var(--ink-soft)]">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold text-base">{title}</h2>
      <div className="space-y-2 text-[var(--ink-soft)]">{children}</div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border border-[var(--line)] bg-[var(--sand-deep)] px-3 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="border border-[var(--line)] px-3 py-2 text-[var(--ink-soft)]">{children}</td>;
}
