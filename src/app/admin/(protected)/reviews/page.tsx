"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Review } from "@/lib/types";

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch("/api/admin/reviews")
      .then((r) => r.json())
      .then((data) => setReviews(data.reviews || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/reviews")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setReviews(data.reviews || []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleDelete(id: number) {
    if (!confirm("이 후기를 삭제하시겠습니까?")) return;
    await fetch(`/api/admin/reviews/${id}`, { method: "DELETE" });
    load();
  }

  async function togglePublish(review: Review) {
    await fetch(`/api/admin/reviews/${review.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublished: review.is_published !== 1 }),
    });
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold">후기 관리</h1>
        <Link
          href="/admin/reviews/new"
          className="rounded-full bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white"
        >
          + 후기 작성
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-soft)]">
              <th className="px-4 py-3 font-medium">청소 종류</th>
              <th className="px-4 py-3 font-medium">지역</th>
              <th className="px-4 py-3 font-medium">작성일</th>
              <th className="px-4 py-3 font-medium">공개여부</th>
              <th className="px-4 py-3 font-medium">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--ink-soft)]">
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading && reviews.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--ink-soft)]">
                  등록된 후기가 없습니다.
                </td>
              </tr>
            )}
            {reviews.map((r) => (
              <tr key={r.id} className="hover:bg-[var(--sand-deep)]">
                <td className="px-4 py-3">{r.service_type}</td>
                <td className="px-4 py-3">{r.region}</td>
                <td className="px-4 py-3 text-xs text-[var(--ink-soft)]">
                  {new Date(r.created_at).toLocaleDateString("ko-KR")}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => togglePublish(r)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      r.is_published ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[var(--sand-deep)] text-[var(--ink-soft)]"
                    }`}
                  >
                    {r.is_published ? "공개" : "비공개"}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 text-xs">
                    <Link href={`/admin/reviews/${r.id}`} className="font-medium text-[var(--mint)] hover:underline">
                      수정
                    </Link>
                    <button onClick={() => handleDelete(r.id)} className="font-medium text-[var(--rose)] hover:underline">
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
