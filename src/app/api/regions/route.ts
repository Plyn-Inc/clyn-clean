import { NextRequest, NextResponse } from "next/server";
import {
  listByLevel,
  listChildren,
  isServiceArea,
} from "@/database/repositories/region-repository";

export const dynamic = "force-dynamic";

const REGION_CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const NO_STORE = "no-store, max-age=0";

/**
 * 행정구역 계층 조회 (고객 예약폼용).
 *
 * GET /api/regions                         -> 시/도 목록
 * GET /api/regions?parent=<code>           -> 해당 구역의 하위 목록
 * GET /api/regions?availability=<code>     -> 해당 시/군/구 직접예약 가능 여부
 *
 * 행정구역 master는 자주 변하지 않으므로 계층 목록은 CDN/브라우저 캐시를 허용한다.
 * 서비스 가능 여부는 관리자 설정 직후 바로 반영되어야 하므로 별도 no-store 조회한다.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const availability = searchParams.get("availability");

  if (availability) {
    return NextResponse.json(
      { serviceAvailable: await isServiceArea(availability) },
      { headers: { "Cache-Control": NO_STORE } }
    );
  }

  const parent = searchParams.get("parent");
  const areas = parent ? await listChildren(parent) : await listByLevel("sido");
  const imported = parent ? true : areas.length > 0;

  return NextResponse.json(
    {
      imported,
      areas: areas.map((a) => ({
        code: a.code,
        name: a.name,
        level: a.level,
        serviceAvailable: null,
      })),
      ...(imported ? {} : { notice: "행정구역 데이터가 준비되지 않았습니다." }),
    },
    { headers: { "Cache-Control": REGION_CACHE_CONTROL } }
  );
}
