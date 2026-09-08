import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPostBySlug } from "@/lib/posts";

// 블로그 글은 관리자가 언제든 추가/삭제할 수 있으므로 정적 생성하지 않고
// 요청 시점에 서버에서 렌더링합니다.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return {};

  const title = post.seo_title || post.title;
  const description = post.seo_description || post.content.slice(0, 120);

  return {
    title,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title,
      description,
      type: "article",
      url: `/blog/${post.slug}`,
      images: post.cover_image_url ? [post.cover_image_url] : undefined,
    },
  };
}

export default async function BlogDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post || post.is_published !== 1) {
    notFound();
  }

  return (
    <article className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <Link href="/blog" className="text-sm font-medium text-[var(--mint)] hover:underline">
        ← 블로그 목록
      </Link>

      <h1 className="font-display mt-4 text-2xl font-bold leading-snug md:text-3xl">{post.title}</h1>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        {new Date(post.created_at).toLocaleDateString("ko-KR")}
      </p>

      {post.cover_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.cover_image_url}
          alt={post.title}
          className="mt-7 w-full rounded-2xl object-cover"
        />
      )}

      <div className="prose prose-neutral mt-8 max-w-none whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ink)]">
        {post.content}
      </div>

      <div className="mt-12 rounded-2xl border border-[var(--line)] bg-[var(--sand-deep)] p-6 text-center">
        <p className="text-sm font-semibold">궁금한 점이 있으신가요?</p>
        <Link
          href="/contact"
          className="mt-3 inline-block rounded-full bg-[var(--navy)] px-6 py-2.5 text-sm font-semibold text-white"
        >
          문의하기
        </Link>
      </div>
    </article>
  );
}
