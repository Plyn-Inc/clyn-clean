import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DatabaseTimeoutError, isConnectionError } from "@/database/connection";
import {
  createReservationAndDeposit,
  ReservationPersistenceError,
} from "@/lib/reservations";
import { getBankSettings } from "@/lib/settings";
import { bookingMaxDate, BOOKING_WINDOW_DAYS } from "@/lib/booking-window";
import { formatWorkArea, isValidKoreanPhone, todayKST } from "@/lib/utils";
import {
  SERVICE_TYPES,
  HOUSE_TYPES_FIXED,
  HOUSE_SIZES_APARTMENT,
  JIPJEONGRI_PACKAGES,
  EXTRA_OPTIONS,
  VAT_NOTICE,
} from "@/lib/types";

// 고객이 오류 뒤 다시 시도하는 정상 흐름을 막지 않도록 여유 있게 둔다.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
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
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return ip.slice(0, 45);
}

const ALLOWED_HOUSE_TYPE_KEYS = [
  ...HOUSE_TYPES_FIXED,
  ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
] as string[];
const ALLOWED_JIPJEONGRI_PACKAGES = JIPJEONGRI_PACKAGES.map((p) => p.key) as string[];
const ALLOWED_EXTRA_OPTION_KEYS = EXTRA_OPTIONS.map((o) => o.key) as string[];

const quoteSnapshotSchema = z.object({
  basePrice: z.number().finite().nonnegative(),
  estimatedTotal: z.number().finite().positive("견적금액을 확인해주세요."),
  depositAmount: z.number().finite().nonnegative(),
  estimatedBalance: z.number().finite().nonnegative().optional(),
  priceConfirmed: z.literal(true, { message: "확정된 견적금액이 필요합니다." }),
  optionBreakdown: z.array(z.object({
    key: z.string(),
    label: z.string(),
    price: z.number(),
    isConsult: z.boolean(),
  })).optional(),
});

/**
 * 예약 버튼의 서버 검증은 의도적으로 단순하다.
 * 이름/연락처/필수동의/화면에 표시된 견적 snapshot만 검증한다.
 * 날짜·지역·캘린더·가격표를 여기서 다시 DB 조회하지 않는다.
 */
const reservationSchema = z.object({
  customerName: z.string().trim().min(1, "예약자명을 입력해주세요.").max(50),
  customerPhone: z.string().trim().refine(isValidKoreanPhone, "연락처 형식을 확인해주세요."),
  customerEmail: z.string().email().max(100).optional().or(z.literal("")),
  serviceType: z.enum(SERVICE_TYPES as unknown as [string, ...string[]]),
  region: z.string().max(100).default(""),
  address: z.string().max(200).default(""),
  houseTypeKey: z.enum(ALLOWED_HOUSE_TYPE_KEYS as [string, ...string[]]).optional(),
  actualPyeong: z.number().positive().max(1000).optional(),
  jipjeongriPackage: z.enum(ALLOWED_JIPJEONGRI_PACKAGES as [string, ...string[]]).optional(),
  occupancyStatus: z.enum(["before_move_in", "after_move_out", "currently_living"]).optional(),
  desiredDate: z.string().max(10).default(""),
  timeSlot: z.enum(["morning", "afternoon", "all_day"]).default("all_day"),
  entryRoute: z.enum(["calendar", "direct"]).default("direct"),
  extraOptions: z.array(z.enum(ALLOWED_EXTRA_OPTION_KEYS as [string, ...string[]])).max(30).optional(),
  moveOutTime: z.string().max(40).optional(),
  moveInTime: z.string().max(40).optional(),
  extraNotes: z.string().max(1000).optional(),
  hasSitePhotos: z.boolean().optional(),
  depositorName: z.string().trim().max(50).optional(),
  privacyAgreed: z.literal(true, { message: "개인정보 수집·이용에 동의해주세요." }),
  corePrinciplesAgreed: z.literal(true, { message: "안내 핵심 원칙에 동의해주세요." }),
  serviceTermsAgreed: z.literal(true, { message: "청소 서비스 이용 안내에 동의해주세요." }),
  additionalChargeAgreed: z.literal(true, { message: "견적 및 추가요금 안내에 동의해주세요." }),
  areaSido: z.string().max(30).default(""),
  areaSigungu: z.string().max(30).default(""),
  areaDong: z.string().max(30).default(""),
  areaSidoCode: z.string().max(20).optional(),
  areaSigunguCode: z.string().max(20).optional(),
  areaDongCode: z.string().max(20).optional(),
  hasPet: z.boolean().optional(),
  clientQuote: quoteSnapshotSchema,
});

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", code: "RATE_LIMITED" },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = reservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요.", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const data = parsed.data;

  try {
    // 계좌를 같은 성공 응답에 바로 보여주기 위한 유일한 선행 DB 조회다.
    const bank = await getBankSettings();
    if (!bank.bankName || !bank.accountNumber || !bank.accountHolder) {
      return NextResponse.json(
        { error: "입금 계좌 설정을 확인해주세요.", code: "BANK_SETTINGS_NOT_READY" },
        { status: 503 }
      );
    }

    const saved = await createReservationAndDeposit(
      {
        ...data,
        depositorName: data.depositorName || data.customerName,
      },
      data.clientQuote,
      bank.paymentDueHours
    );

    const depositInfo = {
      reservationCode: saved.reservationCode,
      customerName: data.customerName,
      workArea: formatWorkArea({
        sido: data.areaSido,
        sigungu: data.areaSigungu,
        dong: data.areaDong,
      }),
      desiredDate: data.desiredDate || null,
      timeSlot: data.timeSlot,
      moveOutTime: data.moveOutTime ?? null,
      moveInTime: data.moveInTime ?? null,
      totalAmount: saved.totalAmount,
      depositAmount: saved.depositAmount,
      balanceAmount: saved.balanceAmount,
      vatNotice: VAT_NOTICE,
      account: {
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        accountHolder: bank.accountHolder,
      },
      depositDeadline: saved.depositDeadline,
      depositDeadlineHours: bank.paymentDueHours,
    };

    return NextResponse.json(
      {
        reservation: {
          id: saved.reservationId,
          reservation_code: saved.reservationCode,
          reservation_status: "awaiting_deposit",
        },
        payment: {
          id: saved.paymentId,
          payment_status: "pending",
          amount: saved.depositAmount,
        },
        depositInfo,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof ReservationPersistenceError) {
      const cause = (e as Error & { cause?: unknown }).cause;
      if (cause instanceof DatabaseTimeoutError) {
        return NextResponse.json(
          { error: "예약 저장 중 데이터베이스 응답이 지연됐습니다. 다시 시도해주세요.", code: "DB_TIMEOUT", stage: e.stage },
          { status: 503 }
        );
      }
      if (isConnectionError(cause)) {
        return NextResponse.json(
          { error: "예약 서버에 연결하지 못했습니다. 다시 시도해주세요.", code: "DB_UNAVAILABLE", stage: e.stage },
          { status: 503 }
        );
      }
      console.error("[reservations] persistence failed", e.stage, cause ?? e);
      return NextResponse.json(
        { error: "예약 저장 중 오류가 발생했습니다. 다시 시도해주세요.", code: "RESERVATION_SAVE_FAILED", stage: e.stage },
        { status: 500 }
      );
    }
    if (e instanceof DatabaseTimeoutError) {
      return NextResponse.json(
        { error: "예약 서버 응답이 지연되고 있습니다. 다시 시도해주세요.", code: "DB_TIMEOUT", stage: "bank_settings" },
        { status: 503 }
      );
    }
    if (isConnectionError(e)) {
      return NextResponse.json(
        { error: "예약 서버에 연결하지 못했습니다. 다시 시도해주세요.", code: "DB_UNAVAILABLE", stage: "bank_settings" },
        { status: 503 }
      );
    }
    console.error("[reservations] unexpected failure", e);
    return NextResponse.json(
      { error: "예약 저장 중 오류가 발생했습니다. 다시 시도해주세요.", code: "RESERVATION_SAVE_FAILED", stage: "unknown" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const bank = await getBankSettings();
  const today = todayKST();

  return NextResponse.json({
    bank: {
      bankName: bank.bankName,
      accountHolder: bank.accountHolder,
      paymentDueHours: bank.paymentDueHours,
    },
    today,
    bookingMaxDate: bookingMaxDate(),
    bookingWindowDays: BOOKING_WINDOW_DAYS,
  });
}
