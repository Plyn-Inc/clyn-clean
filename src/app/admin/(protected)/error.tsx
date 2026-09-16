"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Admin route error boundary.
 *
 * 한 화면의 데이터 조회가 실패해도 Next.js generic 500으로 떨어지지 않게 한다.
 * 관리자에게는 재시도 수단과 함께, 서버 로그를 찾을 수 있는 digest를 보여준다.
 * (SQL 본문이나 접속정보는 노출하지 않는다)
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(`[admin-error] digest=${error.digest ?? "none"} name=${error.name}`);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center" role="alert">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#FBEAE5] text-2xl text-[var(--rose)]">
        !
      </div>
      <h1 className="font-display text-xl font-bold">화면을 불러오지 못했습니다</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        일시적인 오류일 수 있습니다. 다시 시도해도 같은 화면이 나오면 아래 코드와 함께 알려주세요.
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-xs text-[var(--ink-soft)]">digest: {error.digest}</p>
      )}
      <div className="mt-7 flex justify-center gap-3">
        <button
          onClick={reset}
          className="min-h-[44px] rounded-full bg-[var(--navy)] px-6 text-sm font-semibold text-white"
        >
          다시 시도
        </button>
        <Link
          href="/admin/reservations"
          className="flex min-h-[44px] items-center rounded-full border border-[var(--line)] px-6 text-sm font-semibold text-[var(--ink-soft)]"
        >
          예약 관리로
        </Link>
      </div>
    </div>
  );
}
