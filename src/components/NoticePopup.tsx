"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PopupNotice {
  id: number;
  title: string;
  content: string;
  noticeType: "normal" | "urgent";
}

/** Asia/Seoul 기준 오늘 날짜 (YYYY-MM-DD) */
function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function hideKey(id: number): string {
  return `clyn_notice_hide_${id}`;
}

/**
 * 홈페이지 공지 팝업.
 *
 * - 한 번에 최대 1개만 노출한다 (서버가 우선순위로 1건만 내려준다)
 * - "닫기"는 현재 세션에서만 닫는다
 * - "오늘 하루 보지 않기"는 KST 날짜를 localStorage에 저장해 자정 이후 다시 노출한다
 * - localStorage를 쓸 수 없는 환경에서도 페이지 오류를 내지 않는다
 */
export default function NoticePopup() {
  const [notice, setNotice] = useState<PopupNotice | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const res = await fetch("/api/notices/popup", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notice?: PopupNotice | null };
        if (cancelled || !data.notice) return;

        // 오늘 하루 보지 않기 확인 (localStorage 사용 불가 시 그냥 표시)
        try {
          if (window.localStorage.getItem(hideKey(data.notice.id)) === todayKST()) return;
        } catch {
          /* localStorage 차단 환경 — 팝업은 정상 표시한다 */
        }
        setNotice(data.notice);
      } catch {
        /* 팝업 조회 실패가 홈페이지를 막지 않는다 */
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (!notice || closed) return null;

  function hideToday() {
    if (!notice) return;
    try {
      window.localStorage.setItem(hideKey(notice.id), todayKST());
    } catch {
      /* 저장 실패해도 닫기는 동작해야 한다 */
    }
    setClosed(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notice-popup-title"
    >
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        {notice.noticeType === "urgent" && (
          <span className="inline-block rounded-full bg-[#FBEAE5] px-2.5 py-1 text-xs font-semibold text-[var(--rose)]">
            긴급공지
          </span>
        )}
        <h2 id="notice-popup-title" className="mt-2.5 font-display text-lg font-bold leading-snug">
          {notice.title}
        </h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--ink-soft)]">
          {notice.content}
        </p>

        <div className="mt-6 flex gap-2">
          <Link
            href={`/notice/${notice.id}`}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-[var(--navy)] text-sm font-semibold text-white"
          >
            자세히 보기
          </Link>
          <button
            type="button"
            onClick={() => setClosed(true)}
            className="min-h-[44px] rounded-full border border-[var(--line)] px-5 text-sm font-semibold text-[var(--ink-soft)]"
          >
            닫기
          </button>
        </div>
        <button
          type="button"
          onClick={hideToday}
          className="mt-3 w-full text-center text-xs text-[var(--ink-soft)] underline"
        >
          오늘 하루 보지 않기
        </button>
      </div>
    </div>
  );
}
