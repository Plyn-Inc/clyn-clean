export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { listReviews } from "@/lib/reviews";

export const metadata: Metadata = {
  title: "후기",
  description: "실제 진행된 입주청소 후기를 확인해보세요.",
  alternates: { canonical: "/reviews" },
};

export default async function ReviewListPage() {
  const reviews = await listReviews({ onlyPublished: true });

  return (
    <div className="mx-auto max-w-5xl px-5 py-16 md:px-8">
      <h1 className="font-display text-2xl font-bold md:text-3xl">후기</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">실제 진행된 청소 현장의 후기입니다.</p>

      {reviews.length === 0 ? (
        <p className="mt-12 text-sm text-[var(--ink-soft)]">아직 등록된 후기가 없습니다.</p>
      ) : (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
              <p className="mt-3 line-clamp-5 text-sm leading-relaxed text-[var(--ink-soft)]">{r.content}</p>
              <p className="mt-4 text-xs text-[var(--ink-soft)]">
                {new Date(r.created_at).toLocaleDateString("ko-KR")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
