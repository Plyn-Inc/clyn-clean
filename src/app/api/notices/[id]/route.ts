import { NextRequest, NextResponse } from "next/server";
import { getPublishedNotice } from "@/lib/notices";

/**
 * 공개 공지 단건.
 *
 * 비공개이거나 노출 기간 밖이면 URL로 직접 요청해도 404다.
 * (Admin에서는 별도 API로 확인한다)
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const noticeId = Number(id);
  if (!Number.isFinite(noticeId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const notice = await getPublishedNotice(noticeId);
  if (!notice) {
    return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ notice });
}
