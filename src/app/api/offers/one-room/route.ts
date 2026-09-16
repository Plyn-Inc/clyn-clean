import { NextResponse } from "next/server";
import { getOneRoomOffer } from "@/lib/offers";

export async function GET() {
  try {
    const offer = await getOneRoomOffer();
    if (!offer) {
      return NextResponse.json(
        { error: "현재 원룸 온라인 가격을 확인할 수 없습니다." },
        { status: 404, headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
      );
    }
    return NextResponse.json(offer, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("[one-room-offer] 조회 실패", error);
    return NextResponse.json(
      { error: "가격 정보를 불러오지 못했습니다." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
