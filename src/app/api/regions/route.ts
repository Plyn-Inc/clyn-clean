import { NextRequest, NextResponse } from "next/server";
import { isServiceArea } from "@/database/repositories/region-repository";
import {
  countCachedAdministrativeAreas,
  listCachedAvailableChildren,
  listCachedAvailableSidos,
} from "@/lib/public-region-cache";

export const dynamic = "force-dynamic";

/**
 * 행정구역 계층 조회 (고객 예약폼용).
 * 고객에게는 관리자에서 예약 가능으로 체크한 지역만 반환한다.
 * DB 결과는 짧은 서버 캐시를 재사용하고, 관리자 변경 시 tag 무효화로 즉시 갱신한다.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const availability = searchParams.get("availability");

  if (availability) {
    return NextResponse.json({ serviceAvailable: await isServiceArea(availability) });
  }

  const parent = searchParams.get("parent");
  const areas = parent
    ? await listCachedAvailableChildren(parent)
    : await listCachedAvailableSidos();
  const imported = parent ? true : (areas.length > 0 || (await countCachedAdministrativeAreas()) > 0);

  return NextResponse.json({
    imported,
    areas: areas.map((a) => ({
      code: a.code,
      name: a.name,
      level: a.level,
      serviceAvailable: null,
    })),
    ...(imported ? {} : { notice: "행정구역 데이터가 준비되지 않았습니다." }),
  });
}
