import { NextRequest, NextResponse } from "next/server";
import {
  listByLevel,
  listChildren,
  countAreas,
  enabledServiceAreaCodes,
  findArea,
} from "@/database/repositories/region-repository";
export const dynamic = "force-dynamic";
export const revalidate = 0;


/**
 * 행정구역 계층 조회 (고객 예약폼용).
 *
 * GET /api/regions                → 시/도 목록
 * GET /api/regions?parent=<code>  → 해당 구역의 하위 목록
 *
 * 세종특별자치시처럼 시/군/구 단계가 없는 지역은 sido의 자식이 바로
 * 읍면동이 된다. 응답의 level 값으로 프런트가 단계를 판단한다.
 *
 * 시/군/구 목록에는 서비스 가능 여부(serviceAvailable)를 함께 내려
 * 고객이 선택 시점에 서비스 지역 외임을 알 수 있게 한다.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const parent = searchParams.get("parent");

  const total = await countAreas();
  if (total === 0) {
    // 행정구역 master가 아직 임포트되지 않았다.
    // 임의 데이터를 만들지 않고 상태를 그대로 알린다.
    return NextResponse.json(
      { areas: [], imported: false, areaCount: 0, notice: "행정구역 데이터가 준비되지 않았습니다." },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  const [areas, parentArea] = await Promise.all([
    parent ? listChildren(parent) : listByLevel("sido"),
    parent ? findArea(parent) : Promise.resolve(undefined),
  ]);
  const enabled = await enabledServiceAreaCodes();

  return NextResponse.json({
    imported: true,
    areaCount: total,
    areas: areas.map((a) => ({
      code: a.code,
      name: a.name,
      level: a.level,
      // 일반 지역은 시/군/구 코드로, 세종처럼 시군구 단계가 없으면 시/도 코드로 판정한다.
      serviceAvailable:
        a.level === "sigungu"
          ? enabled.has(a.code)
          : a.level === "eupmyeondong" && parentArea?.level === "sido"
            ? enabled.has(parentArea.code)
            : null,
    })),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
