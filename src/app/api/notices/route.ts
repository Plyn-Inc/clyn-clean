import { NextResponse } from "next/server";
import { listPublishedNotices } from "@/lib/notices";

/** 공개 공지 목록. Admin 전용 필드는 반환하지 않는다. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ notices: await listPublishedNotices() });
  } catch (e) {
    console.error(`[notices] list failed code=${(e as { code?: string })?.code ?? "UNKNOWN"}`);
    return NextResponse.json({ notices: [] });
  }
}
