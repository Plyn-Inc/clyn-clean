import type { MetadataRoute } from "next";
import { buildAbsoluteUrl } from "@/lib/site-url";

/**
 * robots.txt는 검색로봇이 가장 먼저 조회하는 파일이므로 빌드 시 정적으로 생성합니다.
 * DB나 런타임 요청에 의존하지 않습니다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/reservation"],
      },
    ],
    sitemap: buildAbsoluteUrl("/sitemap.xml"),
    host: buildAbsoluteUrl("/"),
  };
}
