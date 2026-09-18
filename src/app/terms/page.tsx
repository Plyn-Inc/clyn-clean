export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCompanySettingsSafe } from "@/lib/settings";

export const metadata: Metadata = {
  title: "서비스 이용약관",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const company = await getCompanySettingsSafe();
  const operator = company.legalCompanyName || company.name;
  const effectiveDate = "2026년 9월 18일";

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold">서비스 이용약관</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">시행일: {effectiveDate}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-[var(--ink)]">
        <Intro>
          본 약관은 {operator}(이하 “회사”)가 운영하는 CLYN CLEAN CARE의 청소 및 관련 서비스 이용에 관한 기본 사항을 정합니다.
        </Intro>

        <Section title="제1조 (목적)">
          <p>본 약관은 회사가 제공하는 청소 서비스의 예약, 이용, 요금 결제 및 회사와 이용자 사이의 권리·의무와 책임사항을 정하는 것을 목적으로 합니다.</p>
        </Section>

        <Section title="제2조 (서비스의 내용)">
          <p>회사는 입주청소, 퇴실청소, 거주청소, 사이청소, 집정리 등 홈페이지에 안내된 서비스를 제공합니다.</p>
          <p>구체적인 작업 범위, 예상 금액, 예약 가능 일정 및 추가 작업 여부는 이용자가 선택한 상품과 현장 상태에 따라 달라질 수 있습니다.</p>
        </Section>

        <Section title="제3조 (예약 및 계약의 성립)">
          <p>이용자는 홈페이지에서 서비스 종류, 작업 장소, 희망일시 및 연락처 등 예약에 필요한 정보를 정확하게 입력해야 합니다.</p>
          <p>예약 신청 후 회사가 예약을 접수하고, 홈페이지에 안내된 예약 선금의 입금 확인 또는 별도의 예약 확정 안내가 이루어진 때 서비스 이용계약이 성립합니다.</p>
          <p>예약 가능 여부, 작업 범위 또는 현장 조건의 추가 확인이 필요한 경우 회사는 이용자에게 연락하여 일정을 조정하거나 상담 예약으로 전환할 수 있습니다.</p>
        </Section>

        <Section title="제4조 (서비스 요금 및 결제)">
          <p>서비스 요금은 홈페이지에서 선택한 주거 형태, 면적, 서비스 종류, 예약일 및 적용 가능한 할인 등에 따라 산정됩니다.</p>
          <p>홈페이지 견적은 이용자가 입력한 정보와 통상적인 작업 범위를 기준으로 하며, 특수오염·폐기물·과도한 오염·추가 작업 등 사전에 확인하기 어려운 사항은 현장 확인 후 추가요금이 발생할 수 있습니다.</p>
          <p>추가요금이 필요한 경우 회사는 작업 진행 전에 해당 내용과 금액을 이용자에게 안내합니다.</p>
          <p>예약 선금은 총 청소금액에 포함되며, 잔금은 회사가 안내한 방법에 따라 지급합니다.</p>
        </Section>

        <Section title="제5조 (예약 변경 및 취소)">
          <p>이용자가 예약 일정의 변경 또는 취소를 원하는 경우 가능한 한 작업 예정일 전에 회사에 알려야 합니다.</p>
          <p>예약 변경 가능 여부는 다른 예약 및 작업 인력 배정 상황에 따라 달라질 수 있습니다.</p>
          <p>취소·환불에 관한 사항은 예약 시 별도로 고지된 조건과 관계 법령에 따르며, 법령에서 정한 이용자의 권리를 제한하지 않습니다.</p>
        </Section>

        <Section title="제6조 (서비스 제공)">
          <p>회사는 확정된 예약 내용에 따라 서비스를 제공하기 위해 합리적으로 노력합니다.</p>
          <p>천재지변, 교통 통제, 작업자의 불가피한 사정 등 정상적인 서비스 제공이 어려운 사유가 발생한 경우 이용자와 협의하여 일정을 변경할 수 있습니다.</p>
          <p>이용자는 작업자가 서비스 장소에 출입하고 정상적으로 작업할 수 있도록 필요한 여건을 마련해야 합니다.</p>
        </Section>

        <Section title="제7조 (이용자의 의무)">
          <p>이용자는 예약 과정에서 사실에 부합하는 정보를 제공하고, 작업에 영향을 줄 수 있는 현장 상태나 주의사항을 회사에 알려야 합니다.</p>
          <p>귀중품, 현금, 중요 서류 및 파손 우려가 큰 물품은 작업 전에 이용자가 직접 안전하게 보관해야 합니다.</p>
          <p>이용자는 서비스 제공을 방해하거나 회사 또는 작업자의 권리를 침해하는 행위를 해서는 안 됩니다.</p>
        </Section>

        <Section title="제8조 (회사의 의무)">
          <p>회사는 관계 법령과 본 약관을 준수하며, 예약된 서비스를 성실하게 제공하기 위해 노력합니다.</p>
          <p>회사는 이용자의 개인정보를 관련 법령 및 개인정보처리방침에 따라 처리합니다.</p>
        </Section>

        <Section title="제9조 (책임의 제한)">
          <p>회사는 회사의 고의 또는 과실로 이용자에게 손해가 발생한 경우 관계 법령에 따라 책임을 부담합니다.</p>
          <p>회사의 책임이 없는 사유, 이용자가 사전에 알리지 않은 물품의 특성이나 하자, 통상적인 청소로 제거하기 어려운 노후·변색·부식 등으로 발생한 결과에 대해서는 회사의 책임이 제한될 수 있습니다.</p>
          <p>본 조는 관계 법령에 따른 회사의 책임을 부당하게 면제하거나 이용자의 법정 권리를 제한하는 것으로 해석되지 않습니다.</p>
        </Section>

        <Section title="제10조 (분쟁 해결)">
          <p>서비스 이용과 관련한 문의나 불만이 있는 경우 회사 고객센터를 통해 해결을 요청할 수 있습니다.</p>
          <p>회사와 이용자 사이에 분쟁이 발생한 경우 상호 협의를 통해 해결하도록 노력하며, 해결되지 않는 경우 관계 법령 및 민사소송법상 관할법원에 따릅니다.</p>
        </Section>

        <Section title="제11조 (약관의 변경)">
          <p>회사는 관계 법령을 위반하지 않는 범위에서 본 약관을 변경할 수 있으며, 변경 시 시행일과 주요 변경 내용을 홈페이지에 게시합니다.</p>
        </Section>

        <Section title="사업자 정보">
          <p>운영주체: {operator}</p>
          <p>브랜드: {company.brandName}</p>
          <p>사업자등록번호: {company.bizNumber}</p>
          <p>통신판매업 신고번호: {company.mailOrderNumber}</p>
          <p>주소: {company.address}</p>
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
