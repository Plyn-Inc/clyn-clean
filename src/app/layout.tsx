import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import type { CompanySettings } from "@/lib/settings";
import { getSiteUrl } from "@/lib/site-url";

const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
});

// layout.tsx에서도 DB를 읽으므로 force-dynamic 처리
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // 빌드 시 DB가 없을 수 있으므로 try/catch로 안전하게 처리
  let siteTitle = "입주청소 예약센터";
  let siteDescription = "예약 가능 날짜를 바로 확인하고, 캘린더 또는 바로 예약하기로 간편하게 예약하세요.";

  try {
    const { getSetting } = await import("@/lib/settings");
    siteTitle = (await getSetting("site_title")) || siteTitle;
    siteDescription = (await getSetting("site_description")) || siteDescription;
  } catch {
    // DB 접근 불가 시 기본값 사용
  }

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

const EMPTY_COMPANY: CompanySettings = {
  name: "",
  phone: "",
  kakaoUrl: "",
  address: "",
  bizNumber: "",
};

async function getCompanyOrDefault(): Promise<CompanySettings> {
  try {
    const { getCompanySettings } = await import("@/lib/settings");
    return await getCompanySettings();
  } catch {
    return EMPTY_COMPANY;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const company = await getCompanyOrDefault();

  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-[var(--sand)] text-[var(--ink)]">
        <SiteHeader companyName={company.name} />
        <main className="flex-1">{children}</main>
        <SiteFooter company={company} />
      </body>
    </html>
  );
}
