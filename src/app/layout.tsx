import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { fallbackCompanySettings, SITE_SEO_FALLBACK } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site-url";

const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
});

/**
 * RootLayout / generateMetadata는 모든 페이지의 first HTML critical path다.
 *
 * 여기서 DB를 await하면 Header/Footer/메타데이터가 PostgreSQL 응답에 묶여
 * DB가 느리거나 unavailable일 때 홈페이지 shell조차 내려가지 못한다.
 * 따라서 이 파일에서는 DB에 접근하지 않고 코드 상수만 사용한다.
 *
 * 관리자에서 변경 가능한 SEO 설정(site_title/site_description)의 실시간 반영보다
 * Production 홈페이지 가용성과 응답속도를 우선한다.
 *
 * DB 기반 데이터가 필요한 섹션은 각 페이지에서 Suspense child로 분리한다.
 */
export function generateMetadata(): Metadata {
  const siteTitle = SITE_SEO_FALLBACK.title;
  const siteDescription = SITE_SEO_FALLBACK.description;

  // SITE_URL 정책은 src/lib/site-url.ts 한 곳에서 관리합니다.
  // production에서 SITE_URL이 없으면 getSiteUrl()이 에러를 throw합니다.
  // development에서는 localhost:3000 fallback이 허용됩니다.
  const metadataBase = new URL(getSiteUrl());

  return {
    metadataBase,
    title: { default: siteTitle, template: `%s | ${siteTitle}` },
    description: siteDescription,
    alternates: { canonical: "/" },
    openGraph: {
      title: siteTitle,
      description: siteDescription,
      type: "website",
      locale: "ko_KR",
      siteName: siteTitle,
      url: "/",
    },
    twitter: { card: "summary_large_image", title: siteTitle, description: siteDescription },
    robots: { index: true, follow: true },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 브랜드/법인 정보는 코드 상수로 즉시 렌더링한다 (DB 접근 0).
  const company = fallbackCompanySettings();

  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-[var(--sand)] text-[var(--ink)]">
        <SiteHeader companyName={company.brandName} />
        <main className="flex-1">{children}</main>
        <SiteFooter company={company} />
      </body>
    </html>
  );
}
