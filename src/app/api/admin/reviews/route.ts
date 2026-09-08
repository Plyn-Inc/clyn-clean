import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { listReviews, createReview } from "@/lib/reviews";

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const reviews = await listReviews();
  return NextResponse.json({ reviews });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  if (!body?.serviceType || !body?.region || !body?.content) {
    return NextResponse.json({ error: "청소 종류, 지역, 후기 내용은 필수입니다." }, { status: 400 });
  }

  try {
    const review = await createReview({
      serviceType: body.serviceType,
      region: body.region,
      areaPyeong: body.areaPyeong ? Number(body.areaPyeong) : undefined,
      content: body.content,
      beforePhotoUrl: body.beforePhotoUrl || undefined,
      afterPhotoUrl: body.afterPhotoUrl || undefined,
      isPublished: body.isPublished !== false,
    });
    return NextResponse.json({ review }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "후기 등록 중 오류가 발생했습니다." }, { status: 500 });
  }
}
