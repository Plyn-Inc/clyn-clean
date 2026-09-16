import { NextRequest, NextResponse } from "next/server";
import { issueQuoteToken } from "@/lib/quote-token";
import { calculateDiscounts, CouponError } from "@/lib/discounts";
import { DatabaseTimeoutError, isConnectionError } from "@/database/connection";
import { z } from "zod";
import { calculateQuote, getOptionPrices } from "@/lib/pricing";
import { isInstantDiscountCandidate } from "@/lib/reservations";
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
  timeSlot: z.enum(["morning", "afternoon", "all_day"]).optional(),
  /** 반려동물 있음 — 상담 전환 판정에 사용 */
  hasPet: z.boolean().optional(),
  // --- 정책 검증 입력 (가격/예약 가능 여부를 좌우한다) ---
  // 세종시처럼 시/군/구가 없는 구조에서는 dong/sigungu가 null로 올 수 있다.
  // null을 형식 오류로 처리하면 지역 검증 branch에 도달하지 못한다.
  areaSidoCode: z.string().max(20).nullish(),
  areaSigunguCode: z.string().max(20).nullish(),
  areaDongCode: z.string().max(20).nullish(),
  /** 사이청소 전용 시간 */
  moveOutTime: z.string().max(40).optional(),
  moveInTime: z.string().max(40).optional(),
  /** 고객이 입력한 쿠폰 코드 (선택) */
  couponCode: z.string().max(40).nullish(),
  /** 쿠폰 1인 한도 확인용 (선택) */
  customerPhone: z.string().max(20).nullish(),
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
    areaSidoCode,
    areaSigunguCode,
    areaDongCode,
    moveOutTime,
    moveInTime,
    couponCode,
    customerPhone,
  } = parsed.data;

  // ── B1: 정책 검증 (fail closed) ────────────────────────────────────────
  // 여기서 통과한 결과만 quoteToken으로 서명한다.
  // 검증 플래그를 토큰에 넣지 않는다 — 실패하면 애초에 토큰을 발급하지 않는다.

  // 1) 서비스 가능지역
  //    행정구역 master가 임포트된 경우에만 적용한다. 미임포트 상태에서는
  //    직접 예약을 허용하지 않는다(fail closed).
  {
    const { countAreas, isServiceArea } = await import("@/database/repositories/region-repository");
    const areaCount = await countAreas();
    if (areaCount === 0) {
      return NextResponse.json(
        {
          error: "현재 온라인 예약 가능지역 정보를 준비 중입니다. 전화 또는 카카오톡으로 상담해주세요.",
          code: "SERVICE_AREA_NOT_READY",
        },
        { status: 409 }
      );
    }
    if (!areaSigunguCode) {
      return NextResponse.json(
        { error: "작업 지역을 선택해주세요.", code: "AREA_REQUIRED" },
        { status: 400 }
      );
    }
    if (!(await isServiceArea(areaSigunguCode))) {
      return NextResponse.json(
        {
          error: "선택하신 지역은 현재 직접 예약이 어렵습니다. 상담 접수를 남겨주시면 담당자가 안내드립니다.",
          code: "OUT_OF_SERVICE_AREA",
        },
        { status: 409 }
      );
    }
  }

  // 2) 사이청소 시간 규칙 — 필수 / 입주 > 퇴거 / 예약일과 같은 날
  if (serviceType === "사이청소") {
    if (!moveOutTime?.trim() || !moveInTime?.trim()) {
      return NextResponse.json(
        { error: "퇴거 완료 예정시간과 입주 예정시간을 입력해주세요.", code: "BETWEEN_TIME_REQUIRED" },
        { status: 400 }
      );
    }
    const out = Date.parse(moveOutTime);
    const inn = Date.parse(moveInTime);
    if (!Number.isFinite(out) || !Number.isFinite(inn)) {
      return NextResponse.json(
        { error: "시간 형식을 확인해주세요.", code: "BETWEEN_TIME_INVALID" },
        { status: 400 }
      );
    }
    if (inn <= out) {
      return NextResponse.json(
        { error: "입주 예정시간은 퇴거 완료시간보다 늦어야 합니다.", code: "BETWEEN_TIME_ORDER" },
        { status: 400 }
      );
    }
    if (desiredDate) {
      const sameDay = (v: string) => v.slice(0, 10) === desiredDate;
      if (!sameDay(moveOutTime) || !sameDay(moveInTime)) {
        return NextResponse.json(
          { error: "퇴거/입주 시간은 예약 날짜와 같은 날이어야 합니다.", code: "BETWEEN_TIME_DATE" },
          { status: 400 }
        );
      }
    }
  }

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

  // 견적 표시 단계에서는 캘린더를 다시 조회하지 않는다. 캘린더에서 선택된 슬롯은
  // 할인 후보로 표시하고, 최종 예약 transaction에서 실제 가용성을 다시 검증한다.
  const eligible = isInstantDiscountCandidate(entryRoute, timeSlot);

  try {
    // 현재 고객 UI는 추가옵션을 보내지 않는다. 옵션이 실제 전달된 경우에만 DB를 조회한다.
    if ((extraOptions?.length ?? 0) > 0) {
      const activeOptionKeys = new Set((await getOptionPrices()).map((o) => o.option_key));
      const inactiveSelected = (extraOptions ?? []).find((key) => !activeOptionKeys.has(key));
      if (inactiveSelected) {
        return NextResponse.json(
          { error: "현재 선택할 수 없는 추가 서비스 옵션이 포함되어 있습니다. 옵션을 다시 선택해주세요." },
          { status: 400 }
        );
      }
    }

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

    // 가격표가 없거나 관리자가 비활성화한 상품은 임의 가격을 만들지 않고 차단한다.
    // 40평 이상도 시작가 row가 비활성이면 표시할 금액이 없다.
    if (!quote.productAvailable) {
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
    // 확정 견적이면 서명 토큰을 함께 발급한다.
    // 예약 제출은 이 토큰만 검증하므로 금액을 다시 계산하지 않아도 무결성이 보장된다.
    let quoteToken: string | null = null;
    // 3) 금액 정합성 — 여기서 확정하고 토큰에 넣는다.
    //    예약 제출은 이 값을 다시 계산하지 않는다.
    const total = Math.round(quote.estimatedTotal);
    const deposit = Math.round(quote.depositAmount);
    const balance = total - deposit;
    const amountsValid =
      Number.isFinite(total) && total > 0 &&
      Number.isFinite(deposit) && deposit >= 0 &&
      deposit <= total &&
      balance === total - deposit;

    if (!amountsValid && quote.priceConfirmed && !quote.consultRequired) {
      return NextResponse.json(
        { error: "견적금액을 확인해주세요. 잠시 후 다시 시도해주세요.", code: "QUOTE_AMOUNT_INVALID" },
        { status: 400 }
      );
    }

    // 5) 할인 계산 — 정상가 → 자동 프로모션 → 쿠폰
    //    quote 발급은 쿠폰 사용횟수를 소진하지 않는다.
    const productKeyForDiscount =
      serviceType === "집정리" ? jipjeongriPackage ?? null : houseTypeKey ?? null;
    let discount: Awaited<ReturnType<typeof calculateDiscounts>> | null = null;
    if (quote.priceConfirmed && !quote.consultRequired && amountsValid) {
      try {
        discount = await calculateDiscounts({
          serviceType,
          productKey: productKeyForDiscount,
          originalAmount: total,
          couponCode,
          customerPhone,
        });
      } catch (e) {
        if (e instanceof CouponError) {
          // 쿠폰 오류는 고객이 코드를 고칠 수 있도록 그대로 알린다.
          return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
        }
        throw e;
      }
    }

    const finalTotal = discount ? discount.finalAmount : total;
    const finalBalance = Math.max(finalTotal - deposit, 0);

    // 6) 상품 활성 여부 — productAvailable이 false면 토큰을 발급하지 않는다
    if (quote.priceConfirmed && !quote.consultRequired && quote.productAvailable && amountsValid && quote.estimatedTotal > 0) {
      try {
        quoteToken = issueQuoteToken({
          serviceType,
          productKey: serviceType === "집정리" ? jipjeongriPackage ?? null : houseTypeKey ?? null,
          // 가격을 결정한 입력 조건을 함께 서명한다 (조건이 다르면 재사용 불가)
          desiredDate: desiredDate || null,
          timeSlot: timeSlot || null,
          areaSidoCode: areaSidoCode ?? null,
          areaSigunguCode: areaSigunguCode ?? null,
          areaDongCode: areaDongCode ?? null,
          basePrice: quote.basePrice,
          holidaySurcharge: quote.dateAdjustmentAmount ?? 0,
          dateAdjustmentAmount: quote.dateAdjustmentAmount ?? 0,
          // 할인 기능이 붙으면 여기에 실제 할인액이 들어간다 (구조는 지금 확정)
          originalAmount: discount?.originalAmount ?? total,
          automaticDiscount: discount?.automaticDiscountAmount ?? 0,
          couponDiscount: discount?.couponDiscountAmount ?? 0,
          promotionId: discount?.promotionId ?? null,
          promotionName: discount?.promotionName ?? null,
          couponId: discount?.couponId ?? null,
          couponCode: discount?.couponCode ?? null,
          estimatedTotal: finalTotal,
          depositAmount: deposit,
          estimatedBalance: finalBalance,
        }).token;
      } catch (e) {
        // 서명 키 미설정은 운영 설정 문제다. 견적 자체는 보여주되 토큰은 생략한다.
        console.error(`[quote] token 발급 실패 code=${(e as { code?: string })?.code ?? "UNKNOWN"}`);
      }
    }

    return NextResponse.json({
      quote: publicQuote,
      quoteToken,
      // 고객 화면에 할인 전후를 명확히 보여주기 위한 breakdown
      discount: discount
        ? {
            originalAmount: discount.originalAmount,
            automaticDiscountAmount: discount.automaticDiscountAmount,
            promotionName: discount.promotionName,
            couponDiscountAmount: discount.couponDiscountAmount,
            couponCode: discount.couponCode,
            finalAmount: discount.finalAmount,
            depositAmount: deposit,
            balanceAmount: finalBalance,
          }
        : null,
    });
  } catch (e) {
    if (e instanceof SpecialDayNotSyncedError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    if (e instanceof DatabaseTimeoutError) {
      return NextResponse.json(
        { error: "견적 서버 응답이 지연되고 있습니다. 다시 시도해주세요.", code: "DB_TIMEOUT" },
        { status: 503 }
      );
    }
    if (isConnectionError(e)) {
      return NextResponse.json(
        { error: "견적 서버에 연결하지 못했습니다. 다시 시도해주세요.", code: "DB_UNAVAILABLE" },
        { status: 503 }
      );
    }
    console.error("[quote] calculation failed", e);
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
