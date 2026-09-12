import Link from "next/link";
import { listReviews } from "@/lib/reviews";
import { SectionHeading } from "./ServiceList";

export default async function ReviewsPreview() {
  // DB 실패가 홈페이지 전체를 막지 않도록 이 섹션에서만 흡수한다.
  let reviews: Awaited<ReturnType<typeof listReviews>> = [];
  try {
    reviews = (await listReviews({ onlyPublished: true })).slice(0, 3);
  } catch (e) {
    console.error("[reviews] 조회 실패 — 섹션을 비우고 계속 렌더링합니다.", e);
  }

  return (
    <section id="reviews" className="scroll-mt-24 bg-[var(--sand-deep)] py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading eyebrow="후기" title="이용 고객분들의 후기" />
          <Link href="/reviews" className="text-sm font-semibold text-[var(--mint)] hover:underline">
            후기 전체 보기 →
          </Link>
        </div>

        {reviews.length === 0 ? (
          <p className="mt-10 text-sm text-[var(--ink-soft)]">아직 등록된 후기가 없습니다.</p>
        ) : (
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {reviews.map((r) => (
              <Link
                key={r.id}
                href={`/reviews/${r.slug}`}
                className="block rounded-2xl border border-[var(--line)] bg-white p-6 transition hover:border-[var(--mint)] hover:shadow-sm"
              >
                <p className="text-xs font-semibold text-[var(--mint)]">
                  {r.service_type} · {r.region}
                  {r.area_pyeong ? ` · ${r.area_pyeong}평` : ""}
                </p>
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-[var(--ink-soft)]">
                  {r.content}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
