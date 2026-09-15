import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  fetchOfficialAdministrativeAreas,
  OFFICIAL_LEGAL_DONG_SOURCE,
} from "@/lib/official-administrative-areas";
import {
  countAreas,
  replaceAdministrativeAreaMaster,
} from "@/database/repositories/region-repository";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 행정표준코드관리시스템(code.go.kr)의 법정동 전체자료를 직접 동기화한다.
 * 관리자 세션이 있는 경우에만 실행되며, 임의 지역코드를 생성하지 않는다.
 */
export async function POST() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  try {
    const areas = await fetchOfficialAdministrativeAreas();
    await replaceAdministrativeAreaMaster(areas);

    const counts = {
      sido: areas.filter((area) => area.level === "sido").length,
      sigungu: areas.filter((area) => area.level === "sigungu").length,
      eupmyeondong: areas.filter((area) => area.level === "eupmyeondong").length,
    };

    return NextResponse.json({
      ok: true,
      source: OFFICIAL_LEGAL_DONG_SOURCE,
      areaCount: await countAreas(),
      counts,
    });
  } catch (error) {
    console.error("[admin/service-areas/sync]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "공식 행정구역 동기화에 실패했습니다." },
      { status: 502 }
    );
  }
}
