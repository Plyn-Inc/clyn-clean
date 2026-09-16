import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { findNoticeById, updateNotice, deleteNotice, kstInputToIso } from "@/lib/notices";
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

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { id } = await ctx.params;
  const notice = await findNoticeById(Number(id));
  if (!notice) return NextResponse.json({ error: "공지를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ notice });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = noticeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요.", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }
  const d = parsed.data;
  await updateNotice(Number(id), {
    title: d.title,
    content: d.content,
    noticeType: d.noticeType,
    isPublished: d.isPublished,
    isPinned: d.isPinned,
    isPopup: d.isPopup,
    publishStartAt: kstInputToIso(d.publishStartAt),
    publishEndAt: kstInputToIso(d.publishEndAt),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { id } = await ctx.params;
  await deleteNotice(Number(id));
  return NextResponse.json({ ok: true });
}
