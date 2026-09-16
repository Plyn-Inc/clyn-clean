import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { insertMarketingEvent } from "@/database/repositories/marketing-repository";

const nullableShort = z.string().max(200).nullable();
const attributionSchema = z.object({
  visitorId: z.string().min(8).max(100),
  firstSource: nullableShort,
  firstMedium: nullableShort,
  firstCampaign: nullableShort,
  firstKeyword: nullableShort,
  lastSource: nullableShort,
  lastMedium: nullableShort,
  lastCampaign: nullableShort,
  lastKeyword: nullableShort,
  landingPage: z.string().max(500),
  firstVisitAt: z.string().max(40),
});

const bodySchema = z.object({
  eventName: z.enum(["landing_view", "booking_started", "quote_started", "kakao_clicked"]),
  attribution: attributionSchema,
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "잘못된 이벤트입니다." }, { status: 400 });
  }

  try {
    await insertMarketingEvent(parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[marketing-event] 저장 실패", error);
    return NextResponse.json({ error: "이벤트 저장 실패" }, { status: 500 });
  }
}
