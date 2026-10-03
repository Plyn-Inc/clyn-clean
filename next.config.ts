import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production") {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl || siteUrl.trim() === "") {
    throw new Error(
      "\n[moving-clean] ⛔ 운영 빌드에 SITE_URL이 설정되지 않았습니다.\n" +
      "  canonical, sitemap, robots, Open Graph URL이 모두 이 값을 기준으로 생성됩니다.\n" +
      "  .env 또는 CI/CD 환경변수에 다음을 추가하세요:\n" +
      "  SITE_URL=https://clyncleancare.kr\n"
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
      "  올바른 형식: SITE_URL=https://clyncleancare.kr\n" +
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
  images: { qualities: [65, 75] },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.clyncleancare.kr" }],
        destination: "https://clyncleancare.kr/:path*",
        permanent: true,
      },
    ];
  },
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
