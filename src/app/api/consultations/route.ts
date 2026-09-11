import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createConsultation } from "@/lib/consultations";
import { CONSULTATION_COMPLETE_NOTICE, SERVICE_TYPES } from "@/lib/types";
import { isValidKoreanPhone, isValidDateFormat, isValidWorkArea } from "@/lib/utils";
import { isWithinBookingWindow, outOfWindowMessage } from "@/lib/booking-window";

// Rate limiting — 예약 API와 동일한 정책
const WINDOW_MS = 10 * 60 * 1000;
const MAX = 5;
const rateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now > e.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (e.count >= MAX) return false;
  e.count++;
  return true;
}

const schema = z.object({
  customerName: z.string().trim().min(1, "이름을 입력해주세요.").max(50),
  customerPhone: z.string().trim().min(9, "연락처를 입력해주세요.").max(20),
  areaSido: z.string().trim().max(30).optional(),
  areaSigungu: z.string().trim().max(30).optional(),
  areaDong: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  serviceType: z.enum(SERVICE_TYPES as unknown as [string, ...string[]]).optional(),
  houseTypeKey: z.string().max(20).optional(),
  actualPyeong: z.number().positive().max(1000).optional(),
  preferredDate: z.string().optional(),
  preferredTimeSlot: z.enum(["morning", "afternoon"]).optional(),
  reason: z.enum(["size_40_plus", "pet", "price_unconfirmed", "manual"]).optional(),
  petMeta: z.record(z.string(), z.unknown()).nullable().optional(),
  extraNotes: z.string().max(2000).optional(),
  /** 집정리 상담 전용 — 정리 공간/물품 정보 (평형 대체) */
  jipjeongriInfo: z.string().max(1000).optional(),
  privacyAgreed: z.boolean().refine((v) => v === true, "개인정보 수집·이용에 동의해주세요."),
});

export async function POST(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0].trim() : "unknown").slice(0, 45);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." },
      { status: 400 }
    );
  }
  const data = parsed.data;

  if (!isValidKoreanPhone(data.customerPhone)) {
    return NextResponse.json({ error: "연락처 형식이 올바르지 않습니다." }, { status: 400 });
  }

  // ── 필수정보 서버 검증 (클라이언트 검증에 의존하지 않는다) ──────────────
  // 공통 필수: 이름 · 연락처 · 작업지역 · 희망일 · 상담내용 · 개인정보 동의
  if (!isValidWorkArea({ sido: data.areaSido, sigungu: data.areaSigungu, dong: data.areaDong })) {
    return NextResponse.json(
      { error: "작업지역(시/도 · 시군구 · 행정동)을 모두 입력해주세요." },
      { status: 400 }
    );
  }
  if (!data.preferredDate) {
    return NextResponse.json({ error: "희망 날짜를 선택해주세요." }, { status: 400 });
  }
  if (!isValidDateFormat(data.preferredDate)) {
    return NextResponse.json({ error: "희망 날짜 형식이 올바르지 않습니다." }, { status: 400 });
  }
  // 예약 가능 기간은 booking-window 단일 원천으로 서버에서 검증한다
  if (!isWithinBookingWindow(data.preferredDate)) {
    return NextResponse.json(
      { error: outOfWindowMessage(), code: "OUT_OF_BOOKING_WINDOW" },
      { status: 400 }
    );
  }
  if (!data.extraNotes?.trim()) {
    return NextResponse.json({ error: "상담 내용을 입력해주세요." }, { status: 400 });
  }
  if (!data.serviceType) {
    return NextResponse.json({ error: "청소 종류를 선택해주세요." }, { status: 400 });
  }

  // 서비스별 필수: 집정리는 평형 대신 정리 관련 정보를 받는다
  if (data.serviceType === "집정리") {
    if (!data.jipjeongriInfo?.trim()) {
      return NextResponse.json(
        { error: "정리가 필요한 공간이나 물품을 입력해주세요." },
        { status: 400 }
      );
    }
  } else {
    // 일반 청소는 주택유형 또는 공급면적 중 하나가 반드시 필요하다
    if (!data.houseTypeKey && !data.actualPyeong) {
      return NextResponse.json(
        { error: "주택유형 또는 공급면적을 입력해주세요." },
        { status: 400 }
      );
    }
  }

  try {
    const created = await createConsultation({
      ...data,
      extraNotes:
        data.serviceType === "집정리" && data.jipjeongriInfo
          ? `${data.extraNotes ?? ""}\n[정리 요청] ${data.jipjeongriInfo}`.trim()
          : data.extraNotes,
    });
    // 상담접수는 캘린더 슬롯을 점유하지 않는다. payment도 만들지 않는다.
    return NextResponse.json(
      {
        requestCode: created.request_code,
        notice: CONSULTATION_COMPLETE_NOTICE,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("[consultations]", e);
    return NextResponse.json({ error: "상담 접수 중 오류가 발생했습니다." }, { status: 500 });
  }
}
