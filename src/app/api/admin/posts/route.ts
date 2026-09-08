import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { listPosts, createPost } from "@/lib/posts";

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const posts = await listPosts();
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body?.title || !body?.content) {
    return NextResponse.json({ error: "제목과 본문은 필수입니다." }, { status: 400 });
  }

  try {
    const post = await createPost({
      title: body.title,
      content: body.content,
      coverImageUrl: body.coverImageUrl || undefined,
      seoTitle: body.seoTitle || undefined,
      seoDescription: body.seoDescription || undefined,
      isPublished: body.isPublished !== false,
      slug: body.slug || undefined,
    });
    return NextResponse.json({ post }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "글 등록 중 오류가 발생했습니다." }, { status: 500 });
  }
}
