import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { listAllNotices, insertNotice, kstInputToIso } from "@/lib/notices";
import { z } from "zod";

const noticeSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해주세요.").max(200),
  content: z.string().trim().min(1, "내용을 입력해주세요.").max(10000),
  noticeType: z.enum(["normal", "urgent"]).default("normal"),
  isPublished: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  isPopup: z.boolean().default(false),
  publishStartAt: z.string().max(40).nullish(),
  publishEndAt: z.string().max(40).nullish(),
});

/** Admin은 공개 여부와 무관하게 전체를 본다 */
export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  return NextResponse.json({ notices: await listAllNotices() });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const body = await req.json().catch(() => null);
  const parsed = noticeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요.", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  const d = parsed.data;
  const id = await insertNotice({
    title: d.title,
    content: d.content,
    noticeType: d.noticeType,
    isPublished: d.isPublished,
    isPinned: d.isPinned,
    isPopup: d.isPopup,
    // Admin 입력은 Asia/Seoul로 해석해 저장한다
    publishStartAt: kstInputToIso(d.publishStartAt),
    publishEndAt: kstInputToIso(d.publishEndAt),
    createdBy: session.adminId,
  });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
