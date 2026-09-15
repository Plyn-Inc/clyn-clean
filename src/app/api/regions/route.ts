import { NextRequest, NextResponse } from "next/server";
import {
  listAvailableSidos,
  listAvailableChildren,
  isServiceArea,
  countAreas,
} from "@/database/repositories/region-repository";

export const dynamic = "force-dynamic";

const NO_STORE = "no-store, max-age=0";

/**
 * 행정구역 계층 조회 (고객 예약폼용).
 *
 * GET /api/regions                         -> 예약 가능한 시/도가 있는 목록
 * GET /api/regions?parent=<code>           -> 예약 가능 지역만 포함한 하위 목록
 * GET /api/regions?availability=<code>     -> 해당 시/군/구 직접예약 가능 여부
 *
 * 고객에게는 관리자에서 예약 가능으로 체크한 지역만 반환한다.
 * 관리자 변경이 즉시 반영되도록 HTTP 캐시는 사용하지 않고, 반복 조회 방지는 클라이언트 세션 캐시가 담당한다.
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
  const areas = parent ? await listAvailableChildren(parent) : await listAvailableSidos();
  const imported = parent ? true : (areas.length > 0 || (await countAreas()) > 0);

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
    { headers: { "Cache-Control": NO_STORE } }
  );
}
