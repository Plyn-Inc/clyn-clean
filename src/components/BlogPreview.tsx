import Link from "next/link";
import { listPosts } from "@/lib/posts";
import { SectionHeading } from "./ServiceList";

export default async function BlogPreview() {
  // DB 실패가 홈페이지 전체를 막지 않도록 이 섹션에서만 흡수한다.
  let posts: Awaited<ReturnType<typeof listPosts>> = [];
  try {
    posts = (await listPosts({ onlyPublished: true })).slice(0, 3);
  } catch (e) {
    console.error("[posts] 조회 실패 — 섹션을 비우고 계속 렌더링합니다.", e);
  }

  return (
    <section className="bg-[var(--sand)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading eyebrow="블로그" title="입주청소 정보 콘텐츠" />
          <Link href="/blog" className="text-sm font-semibold text-[var(--mint)] hover:underline">
            블로그 전체 보기 →
          </Link>
        </div>

        {posts.length === 0 ? (
          <p className="mt-10 text-sm text-[var(--ink-soft)]">아직 등록된 글이 없습니다.</p>
        ) : (
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {posts.map((p) => (
              <Link
                key={p.id}
                href={`/blog/${p.slug}`}
                className="block overflow-hidden rounded-2xl border border-[var(--line)] bg-white transition hover:border-[var(--mint)] hover:shadow-sm"
              >
                {p.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.cover_image_url} alt={p.title} className="h-40 w-full object-cover" />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center bg-[var(--mint-soft)] text-[var(--mint)]">
                    <span className="text-3xl">📄</span>
                  </div>
                )}
                <div className="p-5">
                  <p className="font-display line-clamp-2 text-base font-bold">{p.title}</p>
                  <p className="mt-2 text-xs text-[var(--ink-soft)]">
                    {new Date(p.created_at).toLocaleDateString("ko-KR")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
