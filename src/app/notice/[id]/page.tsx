export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedNotice } from "@/lib/notices";

export default async function NoticeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const noticeId = Number(id);
  if (!Number.isFinite(noticeId)) notFound();

  // 비공개이거나 노출 기간 밖이면 URL로 직접 와도 노출하지 않는다
  const notice = await getPublishedNotice(noticeId);
  if (!notice) notFound();

  return (
    <article className="mx-auto max-w-3xl px-5 py-14">
      <div className="flex items-center gap-2">
        {notice.noticeType === "urgent" && (
          <span className="rounded-full bg-[#FBEAE5] px-2.5 py-1 text-xs font-semibold text-[var(--rose)]">
            긴급공지
          </span>
        )}
        <span className="text-xs text-[var(--ink-soft)]">{notice.publishedAt.slice(0, 10)}</span>
      </div>

      <h1 className="mt-3 font-display text-2xl font-bold leading-snug">{notice.title}</h1>

      {/*
        content는 평문 텍스트다. HTML로 렌더링하지 않으며(XSS 방지)
        줄바꿈만 whitespace-pre-line으로 표시한다.
      */}
      <div className="mt-7 whitespace-pre-line text-sm leading-relaxed text-[var(--ink)]">
        {notice.content}
      </div>

      <Link
        href="/notice"
        className="mt-10 inline-flex min-h-[44px] items-center rounded-full border border-[var(--line)] px-6 text-sm font-semibold text-[var(--ink-soft)]"
      >
        목록으로
      </Link>
    </article>
  );
}
