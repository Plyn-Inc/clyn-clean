import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  listServiceAreas,
  setServiceArea,
  listByLevel,
  countAreas,
} from "@/database/repositories/region-repository";

/** 서비스 가능지역 목록 + 행정구역 임포트 상태 */
export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const [areas, sidoList, total] = await Promise.all([
    listServiceAreas(),
    listByLevel("sido"),
    countAreas(),
  ]);

  return NextResponse.json({
    serviceAreas: areas,
    sidoList,
    areaImported: total > 0,
    areaCount: total,
  });
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
  return NextResponse.json({ ok: true });
}
