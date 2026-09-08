import type { MetadataRoute } from "next";
import { buildAbsoluteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 검색 노출 대상 정적 페이지
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: buildAbsoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: buildAbsoluteUrl("/blog"), changeFrequency: "daily", priority: 0.8 },
    { url: buildAbsoluteUrl("/reviews"), changeFrequency: "daily", priority: 0.8 },
    { url: buildAbsoluteUrl("/contact"), changeFrequency: "monthly", priority: 0.5 },
  ];

  let postRoutes: MetadataRoute.Sitemap = [];
  let reviewRoutes: MetadataRoute.Sitemap = [];

  try {
    const { listPosts } = await import("@/lib/posts");
    const { listReviews } = await import("@/lib/reviews");

    postRoutes = (await listPosts({ onlyPublished: true })).map((p) => ({
      url: buildAbsoluteUrl(`/blog/${p.slug}`),
      lastModified: p.updated_at,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));

    reviewRoutes = (await listReviews({ onlyPublished: true })).map((r) => ({
      url: buildAbsoluteUrl(`/reviews/${r.slug}`),
      lastModified: r.updated_at,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }));
  } catch {
    // DB 접근 불가 시 정적 라우트만 반환
  }

  return [...staticRoutes, ...postRoutes, ...reviewRoutes];
}
