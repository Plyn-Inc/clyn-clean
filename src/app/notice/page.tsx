export const dynamic = "force-dynamic";
import Link from "next/link";
import { listPublishedNotices } from "@/lib/notices";
import { SectionHeading } from "@/components/ServiceList";

export const metadata = { title: "공지사항" };

export default async function NoticeListPage() {
  let notices: Awaited<ReturnType<typeof listPublishedNotices>> = [];
  try {
    notices = await listPublishedNotices();
  } catch (e) {
    console.error(`[notice] list failed code=${(e as { code?: string })?.code ?? "UNKNOWN"}`);
  }

  return (
    <section className="mx-auto max-w-3xl px-5 py-14">
      <SectionHeading eyebrow="NOTICE" title="공지사항" />

      {notices.length === 0 ? (
        <p className="mt-10 text-center text-sm text-[var(--ink-soft)]">등록된 공지가 없습니다.</p>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {notices.map((n) => (
            <li key={n.id}>
              <Link href={`/notice/${n.id}`} className="flex items-center gap-3 py-4 hover:bg-[var(--sand-deep)]">
                {n.noticeType === "urgent" && (
                  <span className="shrink-0 rounded-full bg-[#FBEAE5] px-2 py-0.5 text-[11px] font-semibold text-[var(--rose)]">
                    긴급
                  </span>
                )}
                {n.isPinned && (
                  <span className="shrink-0 rounded-full bg-[var(--sand-deep)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink-soft)]">
                    고정
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                <span className="shrink-0 text-xs text-[var(--ink-soft)]">
                  {n.publishedAt.slice(0, 10)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
