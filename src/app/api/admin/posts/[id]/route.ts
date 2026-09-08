import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { getPostById, updatePost, deletePost } from "@/lib/posts";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const post = await getPostById(Number(id));
  if (!post) return NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ post });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  try {
    await updatePost(Number(id), {
      title: body.title,
      content: body.content,
      coverImageUrl: body.coverImageUrl,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      isPublished: body.isPublished,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "수정 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  await deletePost(Number(id));
  return NextResponse.json({ ok: true });
}
