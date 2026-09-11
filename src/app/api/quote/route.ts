import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculateQuote, getOptionPrices } from "@/lib/pricing";
import { computeInstantDiscountEligible } from "@/lib/reservations";
import { SpecialDayNotSyncedError } from "@/lib/special-days-store";
import { isWithinBookingWindow, outOfWindowMessage } from "@/lib/booking-window";
import {
  SERVICE_TYPES,
  HOUSE_TYPES_FIXED,
  HOUSE_SIZES_APARTMENT,
  JIPJEONGRI_PACKAGES,
  EXTRA_OPTIONS,
} from "@/lib/types";

const ALLOWED_HOUSE_TYPE_KEYS = [
  ...HOUSE_TYPES_FIXED,
  ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
] as string[];
const ALLOWED_JIPJEONGRI = JIPJEONGRI_PACKAGES.map((p) => p.key) as string[];
const ALLOWED_OPTIONS = EXTRA_OPTIONS.map((o) => o.key) as string[];

const quoteSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES as unknown as [string, ...string[]]),
  houseTypeKey: z.enum(ALLOWED_HOUSE_TYPE_KEYS as [string, ...string[]]).optional(),
  jipjeongriPackage: z.enum(ALLOWED_JIPJEONGRI as [string, ...string[]]).optional(),
  actualPyeong: z.number().positive().max(1000).optional(),
  extraOptions: z.array(z.enum(ALLOWED_OPTIONS as [string, ...string[]])).optional(),
  entryRoute: z.enum(["calendar", "direct"]).optional(),
  desiredDate: z.string().optional(),
  timeSlot: z.enum(["morning", "afternoon"]).optional(),
  /** 반려동물 있음 — 상담 전환 판정에 사용 */
  hasPet: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = quoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." },
      { status: 400 }
    );
  }

  const {
    serviceType,
    houseTypeKey,
    jipjeongriPackage,
    actualPyeong,
    extraOptions,
    entryRoute,
    desiredDate,
    timeSlot,
    hasPet,
  } = parsed.data;

  // 예약 가능 기간 밖 날짜는 견적을 확정하지 않는다 (booking-window 단일 원천)
  if (desiredDate && !isWithinBookingWindow(desiredDate)) {
    return NextResponse.json(
      { error: outOfWindowMessage(), code: "OUT_OF_BOOKING_WINDOW" },
      { status: 400 }
    );
  }

  if (["입주청소", "사이청소", "거주청소"].includes(serviceType) && !houseTypeKey) {
    return NextResponse.json({ error: "주택유형을 선택해주세요." }, { status: 400 });
  }
  if (serviceType === "집정리" && !jipjeongriPackage) {
    return NextResponse.json({ error: "집정리 패키지를 선택해주세요." }, { status: 400 });
  }
  if (houseTypeKey === "40평") {
    if (!actualPyeong) {
      return NextResponse.json({ error: "40평 이상은 실제 평수를 입력해주세요." }, { status: 400 });
    }
    if (actualPyeong < 40) {
      return NextResponse.json(
        { error: "40평 이상 옵션은 실제 평수가 40 이상이어야 합니다." },
        { status: 400 }
      );
    }
  }

  const activeOptionKeys = new Set((await getOptionPrices()).map((o) => o.option_key));
  const inactiveSelected = (extraOptions ?? []).find((key) => !activeOptionKeys.has(key));
  if (inactiveSelected) {
    return NextResponse.json(
      { error: "현재 선택할 수 없는 추가 서비스 옵션이 포함되어 있습니다. 옵션을 다시 선택해주세요." },
      { status: 400 }
    );
  }

  let eligible = false;
  if (entryRoute === "calendar" && desiredDate && timeSlot) {
    try {
      eligible = await computeInstantDiscountEligible("calendar", desiredDate, timeSlot);
    } catch {
      eligible = false;
    }
  }

  try {
    const quote = await calculateQuote({
      serviceType,
      houseTypeKey,
      jipjeongriPackage,
      actualPyeong,
      extraOptions,
      instantDiscountEligible: eligible,
      desiredDate,
      hasPet,
    });

    if (
      serviceType !== "집정리" &&
      (quote.basePrice <= 0 || (houseTypeKey !== "40평" && !quote.priceConfirmed))
    ) {
      return NextResponse.json(
        { error: "현재 선택한 주택유형은 온라인 견적이 비활성화되어 있습니다." },
        { status: 400 }
      );
    }

    // 공개 DTO — 내부 가격 보정 사유와 rule 이름을 고객에게 노출하지 않는다.
    // dateAdjustmentApplied / dateAdjustmentAmount / consultReason은 제거한다.
    const {
      dateAdjustmentApplied: _a,
      dateAdjustmentAmount: _b,
      consultReason: _c,
      ...publicQuote
    } = quote;
    void _a; void _b; void _c;
    return NextResponse.json({ quote: publicQuote });
  } catch (e) {
    if (e instanceof SpecialDayNotSyncedError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "견적 계산 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const options = await getOptionPrices();
    return NextResponse.json({ options });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "옵션 정보를 불러올 수 없습니다." }, { status: 500 });
  }
}
