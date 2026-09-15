import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  countAreas,
  listByLevel,
  listChildren,
} from "@/database/repositories/region-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 관리자 전용 행정구역 master 조회. 서비스지역 ON/OFF와 무관하게 전체 공식 목록을 반환한다. */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const parent = searchParams.get("parent");
  const areas = parent ? await listChildren(parent) : await listByLevel("sido");
  const imported = parent ? true : (areas.length > 0 || (await countAreas()) > 0);

  return NextResponse.json(
    {
      imported,
      areas: areas.map((a) => ({
        code: a.code,
        name: a.name,
        level: a.level,
      })),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
