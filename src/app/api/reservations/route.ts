import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createReservation,
  computeInstantDiscountEligible,
  ReservationNotReadyError,
  DateFullyBookedError,
  DateNotAvailableError,
} from "@/lib/reservations";
import { getBankSettings, checkReservationReadiness } from "@/lib/settings";
import { calculateQuote, getOptionPrices } from "@/lib/pricing";
import { todayKST, isValidDateFormat, isPastDateKST, isTooFarFuture } from "@/lib/utils";
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
  timeSlot: z.enum(["morning", "afternoon"], { message: "오전 또는 오후를 선택해주세요." }),
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
  clientEstimatedTotal: z.number().optional(),
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
  if (isTooFarFuture(dateStr, 365)) return NextResponse.json({ error: "1년 이후 날짜는 선택할 수 없습니다." }, { status: 400 });

  const parsed = reservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." }, { status: 400 });
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

  // 사이청소는 서버에서도 퇴거/입주 시간을 필수 검증하고 순서를 강제합니다.
  if (data.serviceType === "사이청소") {
    if (!data.moveOutTime?.trim() || !data.moveInTime?.trim()) {
      return NextResponse.json(
        { error: "사이청소는 기존 거주자 퇴거 완료시간과 신규 입주 예정시간을 모두 입력해주세요." },
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

  // 관리자에서 OFF한 옵션은 allowlist에 남아 있어도 신규 견적/예약에서 선택할 수 없습니다.
  const activeOptionKeys = new Set((await getOptionPrices()).map((o) => o.option_key));
  const inactiveSelected = (data.extraOptions ?? []).find((key) => !activeOptionKeys.has(key));
  if (inactiveSelected) {
    return NextResponse.json(
      { error: "현재 선택할 수 없는 추가 서비스 옵션이 포함되어 있습니다. 옵션을 다시 선택해주세요." },
      { status: 400 }
    );
  }

  // 서버에서 할인 자격 직접 계산
  const eligible = await computeInstantDiscountEligible(data.entryRoute, data.desiredDate, data.timeSlot);

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
    });
  } catch {
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

  if (
    data.clientEstimatedTotal !== undefined &&
    serverQuote.priceConfirmed &&
    Math.abs(serverQuote.estimatedTotal - data.clientEstimatedTotal) > 100
  ) {
    return NextResponse.json(
      { error: "견적금액이 일치하지 않습니다. 페이지를 새로고침하고 다시 시도해주세요." },
      { status: 400 }
    );
  }

  try {
    let normalizedExtraNotes = data.extraNotes ?? "";
    if (data.serviceType === "사이청소") {
      const timeMetadata = JSON.stringify({
        moveOutTime: data.moveOutTime,
        moveInTime: data.moveInTime,
      });
      normalizedExtraNotes = [normalizedExtraNotes.trim(), `[사이청소시간] ${timeMetadata}`]
        .filter(Boolean)
        .join("\n");
    }

    const { reservation, payment } = await createReservation({
      ...data,
      extraNotes: normalizedExtraNotes || undefined,
      timeSlot: data.timeSlot,
      privacyAgreed: data.privacyAgreed,
    });

    const bank = await getBankSettings();
    return NextResponse.json({
      reservation,
      payment,
      bankInfo: {
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        accountHolder: bank.accountHolder,
        paymentDueHours: bank.paymentDueHours,
      },
    }, { status: 201 });
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
    console.error(e);
    return NextResponse.json({ error: "예약 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function GET() {
  const bank = await getBankSettings();
  const readiness = await checkReservationReadiness();
  const today = todayKST();

  return NextResponse.json({
    bank: {
      bankName: bank.bankName,
      accountNumberMasked: maskAccount(bank.accountNumber),
      accountHolder: bank.accountHolder,
      paymentDueHours: bank.paymentDueHours,
    },
    readiness,
    today,
  });
}

function maskAccount(account: string): string {
  if (!account) return "";
  if (account.length <= 4) return "****";
  return account.slice(0, -4).replace(/[0-9]/g, "*") + account.slice(-4);
}
