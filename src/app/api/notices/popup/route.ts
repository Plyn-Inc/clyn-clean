import { NextResponse } from "next/server";
import { getPopupNotice } from "@/lib/notices";

/**
 * 홈페이지 팝업 후보 1건.
 *
 * 여러 팝업을 동시에 띄우지 않는다. 우선순위: urgent → pinned → 최신.
 * 조회 실패가 홈페이지를 막지 않도록 null을 반환한다.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ notice: await getPopupNotice() });
  } catch (e) {
    console.error(`[notices] popup failed code=${(e as { code?: string })?.code ?? "UNKNOWN"}`);
    return NextResponse.json({ notice: null });
  }
}
