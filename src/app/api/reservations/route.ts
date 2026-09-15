import { NextRequest, NextResponse } from "next/server";
import { DatabaseTimeoutError, isConnectionError } from "@/database/connection";
import { z } from "zod";
import {
  createReservation,
  isInstantDiscountCandidate,
  ReservationNotReadyError,
  DateFullyBookedError,
  DateNotAvailableError,
} from "@/lib/reservations";
import { getBankSettings, checkReservationReadiness } from "@/lib/settings";
import { calculateQuote, getOptionPrices } from "@/lib/pricing";
import { createConsultation } from "@/lib/consultations";
import { SpecialDayNotSyncedError } from "@/lib/special-days-store";
import { CONSULTATION_COMPLETE_NOTICE } from "@/lib/types";
import { todayKST, isValidDateFormat, isPastDateKST } from "@/lib/utils";
import { isWithinBookingWindow, outOfWindowMessage, bookingMaxDate, BOOKING_WINDOW_DAYS } from "@/lib/booking-window";
import {
  SERVICE_TYPES,
  HOUSE_TYPES_FIXED,
  HOUSE_SIZES_APARTMENT,
  JIPJEONGRI_PACKAGES,
  EXTRA_OPTIONS,
} from "@/lib/types";

// ── Rate limiting (메모리 기반, 단일 인스턴스) ─────────────────────────────────
// 운영 환경에서는 Nginx/Caddy 또는 Redis 기반 rate limiting 권장
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10분
const RATE_LIMIT_MAX = 5; // 10분에 최대 5회
const rateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function getClientIp(req: NextRequest): string {
  // X-Forwarded-For는 스푸핑 가능하므로 첫 번째 IP만 신뢰 (프록시 뒤)
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return ip.slice(0, 45); // IPv6 최대 길이 제한
}

// ── 허용 값 목록 ─────────────────────────────────────────────────────────────
const ALLOWED_HOUSE_TYPE_KEYS = [
  ...HOUSE_TYPES_FIXED,
  ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
] as string[];

const ALLOWED_JIPJEONGRI_PACKAGES = JIPJEONGRI_PACKAGES.map((p) => p.key) as string[];
const ALLOWED_EXTRA_OPTION_KEYS = EXTRA_OPTIONS.map((o) => o.key) as string[];

const reservationSchema = z.object({
  customerName: z.string().min(1, "예약자명을 입력해주세요.").max(50),
  customerPhone: z.string().min(9, "연락처를 입력해주세요.").max(20)
    .regex(/^[0-9\-+\s]+$/, "연락처 형식이 올바르지 않습니다."),
  customerEmail: z.string().email().max(100).optional().or(z.literal("")),
  serviceType: z.enum(SERVICE_TYPES as unknown as [string, ...string[]]),
  region: z.string().min(1, "지역을 입력해주세요.").max(100),
  address: z.string().min(1, "주소를 입력해주세요.").max(200),
  houseTypeKey: z.enum(ALLOWED_HOUSE_TYPE_KEYS as [string, ...string[]]).optional(),
  actualPyeong: z.number().positive().max(1000).optional(),
  jipjeongriPackage: z.enum(ALLOWED_JIPJEONGRI_PACKAGES as [string, ...string[]]).optional(),
  occupancyStatus: z.enum(["before_move_in", "after_move_out", "currently_living"]).optional(),
  desiredDate: z.string().min(1, "희망 날짜를 선택해주세요."),
  timeSlot: z.enum(["morning", "afternoon", "all_day"], { message: "예약 시간 정보를 확인해주세요." }),
  entryRoute: z.enum(["calendar", "direct"]),
  extraOptions: z
    .array(z.enum(ALLOWED_EXTRA_OPTION_KEYS as [string, ...string[]], {
      message: "허용되지 않는 추가 옵션입니다.",
    }))
    .max(30)
    .optional(),
  moveOutTime: z.string().max(40).optional(),
  moveInTime: z.string().max(40).optional(),
  extraNotes: z.string().max(1000).optional(),
  hasSitePhotos: z.boolean().optional(),
  depositorName: z.string().min(1, "선입금 입금자명을 입력해주세요.").max(50),
  privacyAgreed: z.boolean().refine(v => v === true, "개인정보 수집·이용에 동의해주세요."),
  // --- 최소 고객정보: 작업지역 (행정구역 동 기준) ---
  areaSido: z.string().trim().min(1, "작업지역 시/도를 선택해주세요.").max(30),
  areaSigungu: z.string().trim().min(1, "작업지역 시/군/구를 선택해주세요.").max(30),
  areaDong: z.string().trim().min(1, "작업지역 행정동을 선택해주세요.").max(30),
  // --- 서비스 3종 필수 동의 (각각 저장) ---
  corePrinciplesAgreed: z.boolean().refine(v => v === true, "안내 핵심 원칙에 동의해주세요."),
  serviceTermsAgreed: z.boolean().refine(v => v === true, "청소 서비스 이용 및 현장 추가사항 안내에 동의해주세요."),
  additionalChargeAgreed: z.boolean().refine(v => v === true, "견적 및 추가요금 안내에 동의해주세요."),
  clientEstimatedTotal: z.number().optional(),
  /** 반려동물 있음 — 서버 상담 gate 판정에 사용 */
  hasPet: z.boolean().optional(),
  /** @deprecated 반려동물 상담 전환 폐지 */
  petMeta: z.record(z.string(), z.unknown()).nullable().optional(),
  // --- 행정구역 code ---
  areaSidoCode: z.string().trim().min(1, "작업지역 시/도 코드를 확인해주세요.").max(20),
  areaSigunguCode: z.string().trim().min(1, "작업지역 시/군/구 코드를 확인해주세요.").max(20),
  areaDongCode: z.string().trim().min(1, "작업지역 읍/면/동 코드를 확인해주세요.").max(20),
});

export async function POST(req: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);

  if (!body?.desiredDate) {
    return NextResponse.json({ error: "희망 날짜를 선택해주세요." }, { status: 400 });
  }

  const dateStr: string = body.desiredDate;
  if (!isValidDateFormat(dateStr)) return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });
  if (isPastDateKST(dateStr)) return NextResponse.json({ error: "과거 날짜는 선택할 수 없습니다." }, { status: 400 });
  // 예약 가능 기간은 booking-window 단일 원천을 사용한다
  if (!isWithinBookingWindow(dateStr)) {
    return NextResponse.json({ error: outOfWindowMessage(), code: "OUT_OF_BOOKING_WINDOW" }, { status: 400 });
  }
  const parsed = reservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요.", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // ── 서비스별 필수값 서버 검증 ───────────────────────────────────────────────
  if (["입주청소", "사이청소", "거주청소"].includes(data.serviceType)) {
    if (!data.houseTypeKey) {
      return NextResponse.json({ error: "주택유형을 선택해주세요." }, { status: 400 });
    }
    // 40평 이상: actualPyeong 필수 (최소 40)
    if (data.houseTypeKey === "40평") {
      if (!data.actualPyeong) {
        return NextResponse.json({ error: "40평 이상은 실제 평수를 입력해주세요." }, { status: 400 });
      }
      if (data.actualPyeong < 40) {
        return NextResponse.json({ error: "40평 이상 옵션은 실제 평수가 40 이상이어야 합니다." }, { status: 400 });
      }
    }
  }

  if (data.serviceType === "집정리") {
    if (!data.jipjeongriPackage) {
      return NextResponse.json({ error: "집정리 패키지를 선택해주세요." }, { status: 400 });
    }
  }

  // 사이청소는 오전/오후 슬롯을 고객이 고르지 않는다.
  // 신규 사이청소는 항상 all_day로 접수해 날짜 전체를 우선 보호한다.
  if (data.serviceType === "사이청소" && data.timeSlot !== "all_day") {
    return NextResponse.json(
      { error: "사이청소는 퇴거/입주 시간으로 접수해주세요.", code: "BETWEEN_CLEANING_ALL_DAY_REQUIRED" },
      { status: 400 }
    );
  }
  if (data.serviceType !== "사이청소" && data.timeSlot === "all_day") {
    return NextResponse.json(
      { error: "일반 청소는 오전 또는 오후 시간대를 선택해주세요.", code: "TIME_SLOT_REQUIRED" },
      { status: 400 }
    );
  }

  // 사이청소는 서버에서도 퇴거/입주 시간을 필수 검증하고 순서를 강제합니다.
  if (data.serviceType === "사이청소") {
    if (!data.moveOutTime?.trim() || !data.moveInTime?.trim()) {
      return NextResponse.json(
        { error: "사이청소는 기존 거주자 퇴거 완료시간과 신규 입주 예정시간을 모두 입력해주세요." },
        { status: 400 }
      );
    }
    if (
      !data.moveOutTime.startsWith(`${data.desiredDate}T`) ||
      !data.moveInTime.startsWith(`${data.desiredDate}T`)
    ) {
      return NextResponse.json(
        { error: "퇴거/입주 시간은 선택한 예약 날짜와 같은 날짜여야 합니다." },
        { status: 400 }
      );
    }
    const moveOutMs = Date.parse(data.moveOutTime);
    const moveInMs = Date.parse(data.moveInTime);
    if (!Number.isFinite(moveOutMs) || !Number.isFinite(moveInMs)) {
      return NextResponse.json({ error: "퇴거/입주 시간 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (moveOutMs >= moveInMs) {
      return NextResponse.json(
        { error: "신규 입주 예정시간은 기존 거주자 퇴거 완료시간보다 이후여야 합니다." },
        { status: 400 }
      );
    }
  }

  // 추가 옵션이 실제로 전달된 경우에만 DB를 조회한다. 현재 고객 UI는 추가옵션을 보내지 않는다.
  if ((data.extraOptions?.length ?? 0) > 0) {
    const activeOptionKeys = new Set((await getOptionPrices()).map((o) => o.option_key));
    const inactiveSelected = data.extraOptions?.find((key) => !activeOptionKeys.has(key));
    if (inactiveSelected) {
      return NextResponse.json(
        { error: "현재 선택할 수 없는 추가 서비스 옵션이 포함되어 있습니다. 옵션을 다시 선택해주세요." },
        { status: 400 }
      );
    }
  }

  // 캘린더 선택 여부만 할인 후보로 잡고 실제 슬롯 가용성은 createReservation의
  // transaction lock 안에서 한 번만 검증한다. 여기서 캘린더 DB를 중복 조회하지 않는다.
  const eligible = isInstantDiscountCandidate(data.entryRoute, data.timeSlot);

  // 공개 예약 API는 클라이언트 견적값 유무와 관계없이 서버에서 항상 견적 가능 상태를 확인합니다.
  let serverQuote: Awaited<ReturnType<typeof calculateQuote>>;
  try {
    serverQuote = await calculateQuote({
      serviceType: data.serviceType,
      houseTypeKey: data.houseTypeKey,
      jipjeongriPackage: data.jipjeongriPackage,
      actualPyeong: data.actualPyeong,
      extraOptions: data.extraOptions,
      instantDiscountEligible: eligible,
      // 날짜 가격 보정은 반드시 서버가 예약일 기준으로 재계산한다.
      // 클라이언트가 평일 가격으로 토요일 예약을 넣을 수 없다.
      desiredDate: data.desiredDate,
      hasPet: data.hasPet,
    });
  } catch (e) {
    if (e instanceof SpecialDayNotSyncedError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    if (e instanceof DatabaseTimeoutError) {
      return NextResponse.json(
        { error: "예약 정보를 확인하는 중 데이터베이스 응답이 지연됐습니다. 다시 시도해주세요.", code: "DB_TIMEOUT" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "현재 견적을 계산할 수 없습니다. 상담을 통해 안내드리겠습니다." }, { status: 400 });
  }

  if (
    data.serviceType !== "집정리" &&
    (serverQuote.basePrice <= 0 || (data.houseTypeKey !== "40평" && !serverQuote.priceConfirmed))
  ) {
    return NextResponse.json(
      { error: "현재 선택한 주택유형은 온라인 견적이 비활성화되어 있습니다." },
      { status: 400 }
    );
  }

  // ── 가격표 검증 ─────────────────────────────────────────────────────────
  // 가격표가 없거나 관리자가 비활성화한 상품은 임의 가격으로 예약시키지 않는다.
  if (!serverQuote.productAvailable) {
    return NextResponse.json(
      {
        error: "현재 선택한 상품은 온라인 예약이 비활성화되어 있습니다. 상담으로 문의해주세요.",
        code: "PRODUCT_UNAVAILABLE",
      },
      { status: 400 }
    );
  }

  // ── 서비스 가능지역 검증 ────────────────────────────────────────────────
  // 공식 행정구역 master가 준비되기 전에는 직접 예약을 열지 않는다(B안).
  // 클라이언트 우회 요청도 서버에서 동일하게 차단한다.
  const { getReservationAreaStatus } = await import("@/database/repositories/region-repository");
  let areaStatus: { masterReady: boolean; serviceEnabled: boolean };
  try {
    areaStatus = await getReservationAreaStatus(data.areaSigunguCode);
  } catch (e) {
    if (e instanceof DatabaseTimeoutError || isConnectionError(e)) {
      return NextResponse.json(
        { error: "예약 서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.", code: e instanceof DatabaseTimeoutError ? "DB_TIMEOUT" : "DB_UNAVAILABLE" },
        { status: 503 }
      );
    }
    throw e;
  }
  if (!areaStatus.masterReady) {
    return NextResponse.json(
      {
        error: "행정구역 데이터가 준비되지 않아 직접 예약을 진행할 수 없습니다. 잠시 후 다시 시도해주세요.",
        code: "REGION_MASTER_NOT_READY",
      },
      { status: 503 }
    );
  }
  if (!areaStatus.serviceEnabled) {
    return NextResponse.json(
      {
        error:
          "선택하신 지역은 현재 직접 예약이 어렵습니다. 상담 접수를 남겨주시면 담당자가 확인 후 안내드립니다.",
        code: "OUT_OF_SERVICE_AREA",
      },
      { status: 409 }
    );
  }

  // ── 상담 전환 gate (서버가 최종 권한) ──────────────────────────────────
  // 40평 이상 등 상담 필요 견적은 일반 예약·예약금 프로세스로 진행하지 않는다.
  // UI에서만 막지 않고 API 자체가 거부한다.
  if (serverQuote.consultRequired) {
    // 같은 상담 파이프라인으로 자동 전환한다.
    // 일반 예약 slot을 점유하지 않고 payment도 만들지 않는다.
    try {
      const consultation = await createConsultation({
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        areaSido: data.areaSido,
        areaSigungu: data.areaSigungu,
        areaDong: data.areaDong,
        address: data.address,
        serviceType: data.serviceType,
        houseTypeKey: data.houseTypeKey,
        actualPyeong: data.actualPyeong,
        preferredDate: data.desiredDate,
        preferredTimeSlot: data.timeSlot,
        reason: serverQuote.consultReason ?? "manual",
        petMeta: data.petMeta ?? null,
        extraNotes: data.extraNotes,
        privacyAgreed: data.privacyAgreed,
      });
      return NextResponse.json(
        {
          consultRequired: true,
          requestCode: consultation.request_code,
          notice: serverQuote.consultNotice ?? CONSULTATION_COMPLETE_NOTICE,
          code: "CONSULT_REQUIRED",
          consultReason: serverQuote.consultReason,
        },
        { status: 409 }
      );
    } catch (e) {
      console.error("[reservations→consultation]", e);
      return NextResponse.json(
        { error: serverQuote.consultNotice ?? "상담 접수가 필요한 예약입니다.", code: "CONSULT_REQUIRED" },
        { status: 409 }
      );
    }
  }

  // 클라이언트가 보낸 금액은 서버 재계산 결과와 일치할 때만 허용한다.
  if (
    data.clientEstimatedTotal !== undefined &&
    serverQuote.priceConfirmed &&
    Math.abs(serverQuote.estimatedTotal - data.clientEstimatedTotal) > 100
  ) {
    return NextResponse.json(
      { error: "견적금액이 일치하지 않습니다. 페이지를 새로고침하고 다시 시도해주세요.", code: "PRICE_CHANGED" },
      { status: 409 }
    );
  }

  try {
    // 사이청소 시간은 move_out_time / move_in_time 정식 컬럼에 저장한다.
    // extra_notes JSON 파싱에 의존하지 않는다.
    const normalizedExtraNotes = data.extraNotes ?? "";

    const { reservation, payment } = await createReservation({
      ...data,
      extraNotes: normalizedExtraNotes || undefined,
      timeSlot: data.timeSlot,
      privacyAgreed: data.privacyAgreed,
      preparedQuote: serverQuote,
      instantDiscountEligible: eligible,
    });

    // 계좌정보는 이 응답에 포함하지 않는다 (요구사항 14·15).
    // 필수 고객정보 + 개인정보 동의 + 서비스 3종 동의를 서버가 재검증한 뒤
    // 별도 엔드포인트(/api/reservations/[code]/deposit-account)로만 반환한다.
    return NextResponse.json({ reservation, payment }, { status: 201 });
  } catch (e) {
    if (e instanceof ReservationNotReadyError) {
      return NextResponse.json({ error: e.message, code: "SETTINGS_NOT_READY" }, { status: 503 });
    }
    if (e instanceof DateFullyBookedError) {
      return NextResponse.json({ error: e.message, code: "DATE_FULLY_BOOKED" }, { status: 409 });
    }
    if (e instanceof DateNotAvailableError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
    }
    if (e instanceof DatabaseTimeoutError) {
      return NextResponse.json(
        { error: "예약 저장 중 데이터베이스 응답이 지연됐습니다. 다시 시도해주세요.", code: "DB_TIMEOUT" },
        { status: 503 }
      );
    }
    if (isConnectionError(e)) {
      return NextResponse.json(
        { error: "예약 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.", code: "DB_UNAVAILABLE" },
        { status: 503 }
      );
    }
    console.error("[reservations] create failed", e);
    return NextResponse.json({ error: "예약 처리 중 오류가 발생했습니다.", code: "RESERVATION_CREATE_FAILED" }, { status: 500 });
  }
}

export async function GET() {
  const bank = await getBankSettings();
  const readiness = await checkReservationReadiness();
  const today = todayKST();

  // 계좌번호(마스킹본 포함)를 초기 payload에 내려보내지 않는다.
  // 예약금 안내가 필요한 시점에 서버 검증을 거쳐 별도로 반환한다.
  return NextResponse.json({
    bank: {
      bankName: bank.bankName,
      accountHolder: bank.accountHolder,
      paymentDueHours: bank.paymentDueHours,
    },
    readiness,
    today,
    // 클라이언트가 동일한 예약 가능 범위를 사용하도록 서버가 내려준다
    bookingMaxDate: bookingMaxDate(),
    bookingWindowDays: BOOKING_WINDOW_DAYS,
  });
}
