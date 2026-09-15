import { revalidateTag } from "next/cache";
import { PUBLIC_REGION_CACHE_TAG } from "@/lib/public-region-cache";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  listServiceAreas,
  setServiceArea,
  countAreas,
} from "@/database/repositories/region-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 서비스 가능지역 목록 + 행정구역 임포트 상태 */
export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const areas = await listServiceAreas();
  const total = await countAreas();

  return NextResponse.json(
    {
      serviceAreas: areas,
      areaImported: total > 0,
      areaCount: total,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const body = await req.json().catch(() => null);
  const sigunguCode = String(body?.sigunguCode ?? "");
  if (!sigunguCode) {
    return NextResponse.json({ error: "시/군/구 코드가 필요합니다." }, { status: 400 });
  }

  await setServiceArea({
    sigunguCode,
    isEnabled: body?.isEnabled === true,
    adminNote: body?.adminNote ? String(body.adminNote) : null,
    adminId: session.adminId,
  });
  revalidateTag(PUBLIC_REGION_CACHE_TAG, { expire: 0 });
  return NextResponse.json({ ok: true });
}
