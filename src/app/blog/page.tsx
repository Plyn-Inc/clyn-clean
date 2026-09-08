export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { listPosts } from "@/lib/posts";

export const metadata: Metadata = {
  title: "블로그",
  description: "입주청소, 이사, 청소 관리 팁 등 유용한 정보를 전해드립니다.",
  alternates: { canonical: "/blog" },
};

export default async function BlogListPage() {
  const posts = await listPosts({ onlyPublished: true });

  return (
    <div className="mx-auto max-w-5xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold md:text-3xl">블로그</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">입주청소와 관련된 다양한 정보를 전해드립니다.</p>

      {posts.length === 0 ? (
        <p className="mt-12 text-sm text-[var(--ink-soft)]">아직 등록된 글이 없습니다.</p>
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link
              key={p.id}
              href={`/blog/${p.slug}`}
              className="block overflow-hidden rounded-2xl border border-[var(--line)] bg-white transition hover:border-[var(--mint)] hover:shadow-sm"
            >
              {p.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.cover_image_url} alt={p.title} className="h-44 w-full object-cover" />
              ) : (
                <div className="flex h-44 w-full items-center justify-center bg-[var(--mint-soft)] text-[var(--mint)]">
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
  );
}
