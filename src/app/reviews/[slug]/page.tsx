import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getReviewBySlug } from "@/lib/reviews";

// 후기는 관리자가 언제든 추가/삭제할 수 있으므로 정적 생성하지 않고
// 요청 시점에 서버에서 렌더링합니다.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const review = await getReviewBySlug(slug);
  if (!review) return {};

  const title = `${review.service_type} 후기 - ${review.region}`;
  const description = review.content.slice(0, 120);

  return {
    title,
    description,
    alternates: { canonical: `/reviews/${review.slug}` },
    openGraph: {
      title,
      description,
      url: `/reviews/${review.slug}`,
      images: review.after_photo_url ? [review.after_photo_url] : undefined,
    },
  };
}

export default async function ReviewDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const review = await getReviewBySlug(slug);

  if (!review || review.is_published !== 1) {
    notFound();
  }

  return (
    <article className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <Link href="/reviews" className="text-sm font-medium text-[var(--mint)] hover:underline">
        ← 후기 목록
      </Link>

      <p className="mt-4 text-xs font-semibold text-[var(--mint)]">
        {review.service_type} · {review.region}
        {review.area_pyeong ? ` · ${review.area_pyeong}평` : ""}
      </p>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        {new Date(review.created_at).toLocaleDateString("ko-KR")}
      </p>

      {(review.before_photo_url || review.after_photo_url) && (
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {review.before_photo_url && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--ink-soft)]">작업 전</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={review.before_photo_url}
                alt="작업 전"
                className="w-full rounded-xl object-cover"
              />
            </div>
          )}
          {review.after_photo_url && (
            <div>
              <p className="mb-2 text-xs font-semibold text-[var(--ink-soft)]">작업 후</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={review.after_photo_url} alt="작업 후" className="w-full rounded-xl object-cover" />
            </div>
          )}
        </div>
      )}

      <div className="prose prose-neutral mt-8 max-w-none whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ink)]">
        {review.content}
      </div>

      <div className="mt-12 rounded-2xl border border-[var(--line)] bg-[var(--sand-deep)] p-6 text-center">
        <p className="text-sm font-semibold">비슷한 청소가 필요하신가요?</p>
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
