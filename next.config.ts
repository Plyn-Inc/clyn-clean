import type { NextConfig } from "next";

// production 빌드 시 SITE_URL 유효성을 미리 검증합니다.
// 모든 페이지가 force-dynamic이라 빌드 타임에 getSiteUrl()이 호출되지 않으므로,
// next.config.ts 모듈 로드 시점에 직접 검증합니다.
if (process.env.NODE_ENV === "production") {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl || siteUrl.trim() === "") {
    throw new Error(
      "\n[moving-clean] ⛔ 운영 빌드에 SITE_URL이 설정되지 않았습니다.\n" +
      "  canonical, sitemap, robots, Open Graph URL이 모두 이 값을 기준으로 생성됩니다.\n" +
      "  .env 또는 CI/CD 환경변수에 다음을 추가하세요:\n" +
      "  SITE_URL=https://www.your-actual-domain.co.kr\n"
    );
  }
  try {
    const u = new URL(siteUrl.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`프로토콜이 http/https가 아닙니다: "${u.protocol}"`);
    }
  } catch (e) {
    throw new Error(
      "\n[moving-clean] ⛔ SITE_URL이 유효한 URL이 아닙니다.\n" +
      `  입력값: "${siteUrl}"\n` +
      "  올바른 형식: SITE_URL=https://www.your-actual-domain.co.kr\n" +
      `  원인: ${e instanceof Error ? e.message : e}`
    );
  }
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
