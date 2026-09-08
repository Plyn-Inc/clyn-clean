import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { getReviewById, updateReview, deleteReview } from "@/lib/reviews";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const review = await getReviewById(Number(id));
  if (!review) return NextResponse.json({ error: "후기를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ review });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  try {
    await updateReview(Number(id), {
      serviceType: body.serviceType,
      region: body.region,
      areaPyeong: body.areaPyeong ? Number(body.areaPyeong) : undefined,
      content: body.content,
      beforePhotoUrl: body.beforePhotoUrl,
      afterPhotoUrl: body.afterPhotoUrl,
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
  await deleteReview(Number(id));
  return NextResponse.json({ ok: true });
}
