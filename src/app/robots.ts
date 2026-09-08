import type { MetadataRoute } from "next";
import { buildAbsoluteUrl } from "@/lib/site-url";

// 빌드 타임 정적 생성하면 SITE_URL이 반영되지 않으므로 런타임에 생성합니다.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /admin, /api: 관리자 전용 영역, 외부 노출 불필요
        // /reservation: 예약번호+연락처로 개인정보를 조회하는 페이지 (noindex 적용됨)
        // /privacy는 공개 신뢰 페이지이므로 disallow에서 제거합니다.
        disallow: ["/admin", "/api", "/reservation"],
      },
    ],
    sitemap: buildAbsoluteUrl("/sitemap.xml"),
  };
}
