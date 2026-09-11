import Link from "next/link";
import type { CompanySettings } from "@/lib/settings";

export default function SiteFooter({ company }: { company: CompanySettings }) {
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--navy-deep)] text-[#B8C0CE]">
      <div className="mx-auto max-w-6xl px-5 py-12 md:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <p className="font-display text-lg font-bold tracking-wide text-white">{company.brandName}</p>
            <p className="mt-3 text-sm leading-relaxed">
              예약 가능 날짜를 바로 확인하고, 캘린더 또는 바로 예약하기로
              <br className="hidden md:block" />
              간편하게 예약을 진행하세요.
            </p>
          </div>

          <div className="text-sm leading-relaxed">
            <p className="mb-2 font-semibold text-white">운영주체</p>
            <p>
              {company.legalCompanyName}
              {company.legalCompanyNameEn ? ` (${company.legalCompanyNameEn})` : ""}
            </p>
            {company.bizNumber && <p>사업자등록번호: {company.bizNumber}</p>}
            {company.mailOrderNumber && <p>통신판매신고: {company.mailOrderNumber}</p>}
            {company.address && <p>주소: {company.address}</p>}
            {company.phone && <p>전화: {company.phone}</p>}
          </div>

          <div className="text-sm leading-relaxed">
            <p className="mb-2 font-semibold text-white">바로가기</p>
            <ul className="space-y-1.5">
              <li>
                <Link href="/#calendar" className="hover:text-white">
                  예약 캘린더
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-white">
                  블로그
                </Link>
              </li>
              <li>
                <Link href="/reviews" className="hover:text-white">
                  후기
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-white">
                  문의하기
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 flex flex-wrap gap-4 text-xs text-[#7C8696]">
          <span>
            © {new Date().getFullYear()} {company.brandName}. Operated by {company.legalCompanyNameEn}. All rights reserved.
          </span>
          <Link href="/privacy" className="hover:text-white">개인정보처리방침</Link>
          <Link href="/terms" className="hover:text-white">이용약관</Link>
          <Link href="/refund" className="hover:text-white">취소·환불 정책</Link>
        </div>
      </div>
    </footer>
  );
}
