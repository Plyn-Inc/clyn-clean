import * as reservationRepo from "@/database/repositories/reservation-repository";
import { lockReservationSlot, withTransaction } from "@/database/connection";
import { generateReservationCode, addHoursISO, isValidKoreanPhone, isValidWorkArea } from "./utils";
import { getSlotEffectiveStatus, getDaySlotView } from "./calendar";
import { getPricingSettings, checkReservationReadiness } from "./settings";
import { calculateQuote, getDepositAmountForHouseType } from "./pricing";
import { isAllAgreed, missingAgreements, AGREEMENT_VERSION, isAgreementContentReady } from "./agreement";
import type {
  Reservation,
  Payment,
  ReservationStatus,
  PaymentStatus,
  EntryRoute,
  OccupancyStatus,
  TimeSlot,
  ConfirmationLog,
} from "./types";

// ---------------------------------------------------------------------------
// 에러 클래스
// ---------------------------------------------------------------------------

export class ReservationNotReadyError extends Error {
  missingFields: string[];
  constructor(missingFields: string[]) {
    super("예약금/계좌 정보가 아직 설정되지 않아 예약을 접수할 수 없습니다.");
    this.missingFields = missingFields;
  }
}

export class DateFullyBookedError extends Error {
  constructor(date: string, timeSlot?: TimeSlot) {
    const slotLabel =
      timeSlot === "morning"
        ? " 오전 시간대"
        : timeSlot === "afternoon"
          ? " 오후 시간대"
          : "";
    super(`${date}${slotLabel}는 이미 예약이 마감되었습니다.`);
  }
}

export class DateNotAvailableError extends Error {
  code: "DATE_NOT_AVAILABLE" | "DATE_CONSULT_REQUIRED" | "DATE_OFF";
  constructor(date: string, status: string) {
    let message = `${date}는 예약을 접수할 수 없는 날짜입니다.`;
    let code: DateNotAvailableError["code"] = "DATE_NOT_AVAILABLE";
    if (status === "consult_required") {
      message = `${date}는 상담 후 예약이 필요한 날짜입니다. 문의하기를 이용해주세요.`;
      code = "DATE_CONSULT_REQUIRED";
    } else if (status === "off") {
      message = `${date}는 휴무일입니다.`;
      code = "DATE_OFF";
    }
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 입력 타입
// ---------------------------------------------------------------------------

export interface CreateReservationInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serviceType: string;
  region: string;
  address: string;
  /** 주택유형 키 (원룸/24평 등) — 집정리는 사용 안 함 */
  houseTypeKey?: string;
  /** 실제 평수 (40평 이상 고객이 입력) */
  actualPyeong?: number;
  /** 집정리 패키지 키 */
  jipjeongriPackage?: string;
  areaPyeong?: number; // 레거시 호환
  houseStructure?: string;
  occupancyStatus?: OccupancyStatus;
  desiredDate: string;
  timeSlot: "morning" | "afternoon";
  entryRoute: EntryRoute;
  extraOptions?: string[];
  extraNotes?: string;
  hasSitePhotos?: boolean;
  depositorName: string;
  privacyAgreed?: boolean;
  // --- 최소 고객정보: 작업지역 (행정구역 동 기준) ---
  areaSido?: string;
  areaSigungu?: string;
  areaDong?: string;
  // --- 서비스 3종 동의 (각각 저장) ---
  corePrinciplesAgreed?: boolean;
  serviceTermsAgreed?: boolean;
  additionalChargeAgreed?: boolean;
}

export interface CreateReservationResult {
  reservation: Reservation;
  payment: Payment | null;
}

// ---------------------------------------------------------------------------
// 즉시예약 할인 자격 판정 (단일 기준)
//
// 조건:
//   1. entryRoute === "calendar"  (직접 예약은 할인 없음)
//   2. timeSlot이 morning 또는 afternoon
//   3. 해당 날짜+슬롯의 effectiveStatus === "available"
//   4. 관리자 설정에서 할인 활성화 여부는 calculateQuote()가 판단
//
// 이 함수는 "예약 자격" 여부만 반환한다.
// 실제 할인 금액 계산은 calculateQuote()가 담당한다.
// ---------------------------------------------------------------------------

export async function computeInstantDiscountEligible(
  entryRoute: EntryRoute,
  desiredDate: string,
  timeSlot: "morning" | "afternoon"
): Promise<boolean> {
  if (entryRoute !== "calendar") return false;
  const slotStatus = await getSlotEffectiveStatus(desiredDate, timeSlot);
  return slotStatus === "available";
}

// ---------------------------------------------------------------------------
// 날짜+슬롯 유효성 검증 (신규 예약: morning/afternoon만)
// ---------------------------------------------------------------------------

async function validateSlotAvailability(
  desiredDate: string,
  timeSlot: "morning" | "afternoon"
): Promise<void> {
  const view = await getDaySlotView(desiredDate);
  const slotView = timeSlot === "morning" ? view.morning : view.afternoon;
  const effectiveStatus = slotView.effectiveStatus;

  if (effectiveStatus === "available" && slotView.remaining > 0) return;

  if (
    effectiveStatus === "closed" ||
    (effectiveStatus === "available" && slotView.remaining <= 0)
  ) {
    throw new DateFullyBookedError(desiredDate, timeSlot);
  }

  throw new DateNotAvailableError(desiredDate, effectiveStatus);
}

// ---------------------------------------------------------------------------
// 예약 생성
//
// 흐름:
//   1. 설정 준비 확인
//   2. BEGIN IMMEDIATE (동시 예약 방지)
//   3. 슬롯 가용성 재검증
//   4. 서버에서 할인 자격 계산 (computeInstantDiscountEligible)
//   5. 자격값을 calculateQuote()에 전달 → 견적 계산
//   6. 결과를 DB snapshot에 저장
//   → 화면/API/DB 값이 동일한 로직으로 계산됨
// ---------------------------------------------------------------------------

export async function createReservation(
  input: CreateReservationInput
): Promise<CreateReservationResult> {
  const readiness = await checkReservationReadiness();
  if (!readiness.ready) {
    throw new ReservationNotReadyError(readiness.missingFields);
  }

  // 계좌 정보는 예약 생성 시점에 필요하지 않다.
  // 필수 동의 검증을 통과한 뒤 revealDepositAccount()에서만 조회한다.
  const pricing = await getPricingSettings();

  // 서비스 3종 동의 완료 여부 — 모두 완료된 경우에만 동의서 버전/시각을 기록한다
  // 약관 원문이 준비되지 않았으면 동의 자체를 유효한 것으로 기록하지 않는다.
  const allAgreed =
    isAgreementContentReady() &&
    isAllAgreed({
      corePrinciplesAgreed: input.corePrinciplesAgreed === true,
      serviceTermsAgreed: input.serviceTermsAgreed === true,
      additionalChargeAgreed: input.additionalChargeAgreed === true,
    });
  const code = generateReservationCode();

  let reservationId = 0;

  await withTransaction(async () => {
    await lockReservationSlot(input.desiredDate, input.timeSlot);
    // 3. 슬롯 가용성 재검증 (DB lock 후)
    await validateSlotAvailability(input.desiredDate, input.timeSlot);

    // 4. 서버에서 할인 자격 계산
    const eligible = await computeInstantDiscountEligible(
      input.entryRoute,
      input.desiredDate,
      input.timeSlot
    );

    // 5. 견적 계산 (신규 형식 — houseTypeKey / jipjeongriPackage 사용)
    let estimatedTotal: number | null = null;
    let estimatedBalance: number | null = null;
    let extraPriceSnapshot: number | null = null;
    let optionBreakdownSnapshot: string | null = null;
    let instantDiscountSnapshot: number | null = null;
    // base_price_snapshot = 원본 입주 기준가격 (multiplier 적용 전)
    let basePriceSnap: number | null = null;
    // price_multiplier = 파생 상품 승수 (사이청소 1.5, 거주청소 1.1 등)
    let priceMultiplierSnap: number = 1.0;

    try {
      const q = await calculateQuote({
        serviceType: input.serviceType,
        houseTypeKey: input.houseTypeKey,
        jipjeongriPackage: input.jipjeongriPackage,
        actualPyeong: input.actualPyeong ?? (input.areaPyeong ?? undefined),
        extraOptions: input.extraOptions,
        instantDiscountEligible: eligible,
      });
      estimatedTotal = q.estimatedTotal;
      estimatedBalance = q.estimatedBalance;
      extraPriceSnapshot = q.extraTotal;
      optionBreakdownSnapshot = JSON.stringify(q.optionBreakdown);
      instantDiscountSnapshot = q.instantDiscount > 0 ? q.instantDiscount : null;
      // 원본 기준가격 저장 (사이청소라면 입주청소 기준가격)
      basePriceSnap = q.basePrice > 0 ? q.basePrice : null;
      priceMultiplierSnap = q.multiplier;
    } catch {
      /* 가격 미설정 시 null */
    }

    // areaPyeong 결정:
    //   1. actualPyeong이 있으면 우선 (40평 이상 고객이 직접 입력한 실제 평수)
    //   2. areaPyeong이 있으면 다음 (레거시 호환)
    //   3. houseTypeKey에서 평형 숫자 추출 (예: "34평" → 34)
    //   4. 고정 주택형(원룸 등)은 null 유지
    const keyNum = input.houseTypeKey ? parseInt(input.houseTypeKey, 10) : NaN;
    const pyeongFromKey = !isNaN(keyNum) && keyNum > 0 ? keyNum : null;
    const resolvedAreaPyeong: number | null =
      input.actualPyeong != null ? input.actualPyeong
      : input.areaPyeong != null ? input.areaPyeong
      : pyeongFromKey;

    // 6. DB 저장 (snapshot 값이 위 계산과 일치)
    // priceConfirmedSnapshot: 40평 이상은 0(미확정), 그 외는 1(확정)
    let priceConfirmedSnap = 1;
    try {
      const q2 = await calculateQuote({
        serviceType: input.serviceType,
        houseTypeKey: input.houseTypeKey,
        jipjeongriPackage: input.jipjeongriPackage,
        actualPyeong: input.actualPyeong ?? (input.areaPyeong ?? undefined),
        extraOptions: [],
        instantDiscountEligible: false,
      });
      priceConfirmedSnap = q2.priceConfirmed ? 1 : 0;
    } catch {
      priceConfirmedSnap = 0;
    }

    reservationId = await reservationRepo.insertReservation({
      code,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail ?? null,
      serviceType: input.serviceType,
      region: input.region,
      address: input.address,
      areaPyeong: resolvedAreaPyeong,
      houseTypeKey: input.houseTypeKey ?? null,
      priceMultiplier: priceMultiplierSnap,
      houseStructure: input.houseStructure ?? null,
      occupancyStatus: input.occupancyStatus ?? null,
      desiredDate: input.desiredDate,
      timeSlot: input.timeSlot,
      entryRoute: input.entryRoute,
      extraOptions: JSON.stringify(input.extraOptions ?? []),
      extraNotes: input.extraNotes ?? null,
      hasSitePhotos: input.hasSitePhotos ? 1 : 0,
      basePriceSnapshot: basePriceSnap,
      extraPriceSnapshot,
      optionBreakdownSnapshot,
      depositAmountSnapshot: pricing.depositAmount,
      instantDiscountSnapshot,
      estimatedTotalSnapshot: estimatedTotal,
      estimatedBalanceSnapshot: estimatedBalance,
      priceConfirmedSnapshot: priceConfirmedSnap,
      instantDiscountEligible: eligible ? 1 : 0,
      privacyAgreed: input.privacyAgreed ? 1 : 0,
      areaSido: input.areaSido?.trim() || null,
      areaSigungu: input.areaSigungu?.trim() || null,
      areaDong: input.areaDong?.trim() || null,
      corePrinciplesAgreed: input.corePrinciplesAgreed ? 1 : 0,
      serviceTermsAgreed: input.serviceTermsAgreed ? 1 : 0,
      additionalChargeAgreed: input.additionalChargeAgreed ? 1 : 0,
      // 3종 동의가 모두 완료된 경우에만 동의서 버전/시각을 기록한다
      agreementVersion: allAgreed ? AGREEMENT_VERSION : null,
    });

    // 예약 신청 단계에서는 payment를 생성하지 않는다.
    // 관리자가 승인(approveReservation)하는 시점에 금액을 확정하고 payment를 만든다.
    // 이렇게 해야 승인 전 고객에게 계좌/입금기한이 노출되지 않고 불필요한 환불이 발생하지 않는다.
    await reservationRepo.setReservationStatusRaw(reservationId, "received");

    await reservationRepo.insertLog(
      reservationId,
      null,
      "시스템",
      "reservation_created",
      `예약 접수 (경로: ${input.entryRoute}, 슬롯: ${input.timeSlot}, 할인자격: ${eligible})`
    );

  });

  const reservation = await reservationRepo.findReservationById(reservationId);
  if (!reservation) throw new Error("예약 생성 결과를 찾을 수 없습니다.");

  // 승인 전이므로 payment는 아직 존재하지 않는다 (null).
  const payment = await reservationRepo.findPaymentByReservationId(reservationId);

  return { reservation, payment: payment ?? null };
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export function getReservationById(id: number): Promise<Reservation | undefined> {
  return reservationRepo.findReservationById(id);
}

export function getReservationByCode(code: string): Promise<Reservation | undefined> {
  return reservationRepo.findReservationByCode(code);
}

export function getPaymentByReservationId(reservationId: number): Promise<Payment | undefined> {
  return reservationRepo.findPaymentByReservationId(reservationId);
}

export function listReservations(filter?: {
  status?: ReservationStatus;
  paymentStatus?: PaymentStatus;
  search?: string;
}) {
  return reservationRepo.listReservationsWithPayment(filter);
}

export function listOverdueUnpaidReservations() {
  return reservationRepo.listOverdueUnpaidReservations();
}

// ---------------------------------------------------------------------------
// 예약 상태 변경 (관리자)
// ---------------------------------------------------------------------------

// approved_awaiting_deposit 진입은 approveReservation()으로만 가능하다.
// (일반 status API로 임의 전환할 수 없도록 어느 항목의 목표 상태에도 넣지 않는다)
const ALLOWED_RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  received: ["consult_required", "cancelled"],
  approved_awaiting_deposit: ["consult_required", "cancelled"],
  awaiting_deposit: ["consult_required", "cancelled"],
  awaiting_admin_check: ["consult_required", "cancelled"],
  confirmed: ["completed", "cancelled"],
  consult_required: ["cancelled"],
  cancelled: [],
  completed: [],
};

export async function updateReservationStatus(
  reservationId: number,
  newStatus: ReservationStatus,
  adminName: string,
  adminId: number | null,
  detail?: string
) {
  const current = await reservationRepo.findReservationById(reservationId);
  if (!current) throw new Error("예약을 찾을 수 없습니다.");
  const prev = current.reservation_status;

  if (!ALLOWED_RESERVATION_TRANSITIONS[prev].includes(newStatus)) {
    throw new Error(`허용되지 않는 예약 상태 전이입니다: ${prev} -> ${newStatus}`);
  }

  if (newStatus === "cancelled") {
    const payment = await reservationRepo.findPaymentByReservationId(reservationId);
    if (payment?.payment_status === "confirmed") {
      throw new Error("입금 확인된 예약은 환불 필요 처리 후 취소할 수 있습니다.");
    }
  }

  await reservationRepo.setReservationStatusRaw(reservationId, newStatus);
  if (newStatus === "cancelled") {
    await reservationRepo.markPendingPaymentAsUnconfirmedByReservationId(reservationId);
  }
  await reservationRepo.insertLog(reservationId, adminId, adminName, "status_change", detail ?? "", prev, newStatus);
}

export async function updateAdminMemo(reservationId: number, memo: string) {
  await reservationRepo.setAdminMemo(reservationId, memo);
}

/** 관리자 최종 확정금액 입력 (자동견적 snapshot과 별도 보존) */
export async function updateFinalConfirmedTotal(
  reservationId: number,
  amount: number,
  adminName: string,
  adminId: number | null
) {
  await reservationRepo.setFinalConfirmedTotal(reservationId, amount);
  await reservationRepo.insertLog(
    reservationId,
    adminId,
    adminName,
    "final_total_updated",
    `관리자 최종 견적금액 입력: ${amount.toLocaleString("ko-KR")}원`
  );
}

export function getLogsByReservationId(reservationId: number): Promise<ConfirmationLog[]> {
  return reservationRepo.findLogsByReservationId(reservationId);
}

// ---------------------------------------------------------------------------
// 예약금 계좌 공개 (revealDepositAccount)
//
// 고객이 필수 고객정보 + 개인정보 동의 + 서비스 3종 동의를 완료하고
// 서버 검증을 통과한 시점에 호출된다. 관리자 사전 승인은 필요하지 않다.
//
// 이 시점에 처음으로 payment가 생성되고 계좌정보가 공개된다.
// 그 전에는 계좌정보가 클라이언트로 전달되지 않는다.
//
// 원자성 (withTransaction 하나로 묶음 — 중간 실패 시 전부 롤백):
//   슬롯 재검증 → 상태검증 → 중복 payment 방지 → 금액확정/검증
//   → deposit snapshot 저장 → payment 생성 → account_revealed_at 기록
//   → approved_awaiting_deposit(고객 공개: "예약진행 중") 전환
//
// 금액 규칙:
//   총 청소금액 = 예약 선금 + 현장 잔금  (VAT 자동 가산 없음)
//   balance = final_confirmed_total - deposit_amount_snapshot
//   deposit_amount_snapshot <= final_confirmed_total (위반 시 실패)
// ---------------------------------------------------------------------------

/**
 * 예약금 입금기한(시간). 계좌 안내 시점부터 카운트한다. (요구사항 24)
 */
export const DEPOSIT_DEADLINE_HOURS = 24;

export class DepositAccountError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "DepositAccountError";
    this.code = code;
  }
}

export interface RevealDepositAccountResult {
  reservationId: number;
  finalConfirmedTotal: number;
  depositAmountSnapshot: number;
  balanceAmount: number;
  paymentId: number;
}

export async function revealDepositAccount(
  reservationId: number,
  options?: { finalTotalOverride?: number; memo?: string }
): Promise<RevealDepositAccountResult> {
  return withTransaction(async () => {
    // 1) 예약 조회
    const reservation = await reservationRepo.findReservationById(reservationId);
    if (!reservation) {
      throw new DepositAccountError("예약을 찾을 수 없습니다.", "NOT_FOUND");
    }

    // 2) 승인 가능 상태 검증 (received 에서만 승인 가능)
    if (reservation.reservation_status !== "received") {
      throw new DepositAccountError(
        `현재 예약 상태(${reservation.reservation_status})에서는 예약금 계좌를 안내할 수 없습니다.`,
        "INVALID_STATUS"
      );
    }

    // 2-0) 필수 고객정보 · 개인정보 동의 · 서비스 3종 동의 서버 재검증 (요구사항 14)
    //      클라이언트 검증만 신뢰하지 않는다. 요청을 직접 조작해도 여기서 차단된다.

    // 약관 원문이 준비되지 않았다면 어떤 동의도 유효하지 않다.
    // 빈 약관에 동의한 상태로 계좌가 공개되는 것을 막는다.
    if (!isAgreementContentReady()) {
      throw new DepositAccountError(
        "서비스 이용 동의서가 아직 준비되지 않아 예약금 계좌를 안내할 수 없습니다.",
        "AGREEMENT_CONTENT_NOT_READY"
      );
    }
    if (!reservation.customer_name?.trim()) {
      throw new DepositAccountError("예약자 이름이 필요합니다.", "MISSING_NAME");
    }
    if (!isValidKoreanPhone(reservation.customer_phone ?? "")) {
      throw new DepositAccountError("연락처 형식이 올바르지 않습니다.", "INVALID_PHONE");
    }
    if (!isValidWorkArea({
      sido: reservation.area_sido ?? "",
      sigungu: reservation.area_sigungu ?? "",
      dong: reservation.area_dong ?? "",
    })) {
      throw new DepositAccountError(
        "작업지역(시/도 · 시군구 · 행정동)을 모두 입력해주세요.",
        "MISSING_WORK_AREA"
      );
    }
    if (reservation.privacy_agreed !== 1) {
      throw new DepositAccountError(
        "개인정보 수집·이용 동의가 필요합니다.",
        "PRIVACY_NOT_AGREED"
      );
    }
    const consent = {
      corePrinciplesAgreed: reservation.core_principles_agreed === 1,
      serviceTermsAgreed: reservation.service_terms_agreed === 1,
      additionalChargeAgreed: reservation.additional_charge_agreed === 1,
    };
    if (!isAllAgreed(consent)) {
      throw new DepositAccountError(
        `서비스 이용 동의가 완료되지 않았습니다: ${missingAgreements(consent).join(", ")}`,
        "AGREEMENT_INCOMPLETE"
      );
    }
    if (!reservation.agreement_version) {
      throw new DepositAccountError("동의서 버전이 기록되지 않았습니다.", "AGREEMENT_VERSION_MISSING");
    }

    // 2-1) 동시 예약 방지 — 계좌 공개 직전에 슬롯 가용성을 다시 검증한다.
    //      프런트에서 "예약가능"으로 보였다는 이유만으로 확정하지 않는다.
    if (
      reservation.desired_date &&
      (reservation.time_slot === "morning" || reservation.time_slot === "afternoon")
    ) {
      const slot = reservation.time_slot;
      await lockReservationSlot(reservation.desired_date, slot);
      const view = await getDaySlotView(reservation.desired_date);
      const slotView = slot === "morning" ? view.morning : view.afternoon;
      const others = await reservationRepo.countActiveReservationsOnSlotExcluding(
        reservation.desired_date,
        slot,
        reservationId
      );
      if (slotView.status === "off" || slotView.status === "consult_required") {
        throw new DepositAccountError(
          `${reservation.desired_date} ${slot === "morning" ? "오전" : "오후"}은 현재 예약을 받을 수 없습니다.`,
          "SLOT_UNAVAILABLE"
        );
      }
      if (others >= slotView.capacity) {
        throw new DepositAccountError(
          `${reservation.desired_date} ${slot === "morning" ? "오전" : "오후"} 시간대는 이미 다른 예약이 진행 중입니다.`,
          "SLOT_TAKEN"
        );
      }
    }

    // 3) 중복 payment 방어 — 트랜잭션 내부에서 확인
    const existingPayments = await reservationRepo.countPaymentsByReservationId(reservationId);
    if (existingPayments > 0) {
      throw new DepositAccountError(
        "이미 예약금 계좌가 안내된 예약입니다.",
        "ALREADY_REVEALED"
      );
    }

    // 4) final_confirmed_total 확정
    //    - 자동 산정 평형(price_confirmed_snapshot === 1): 자동견적 금액을 최종금액으로 확정
    //    - 별도견적 평형(40평 이상 등, price_confirmed_snapshot === 0): 관리자가 반드시 금액 입력
    let finalTotal: number;
    if (options?.finalTotalOverride != null) {
      finalTotal = Math.round(options.finalTotalOverride);
    } else if (reservation.final_confirmed_total != null) {
      finalTotal = reservation.final_confirmed_total;
    } else if (
      reservation.price_confirmed_snapshot === 1 &&
      reservation.estimated_total_snapshot != null &&
      reservation.estimated_total_snapshot > 0
    ) {
      finalTotal = reservation.estimated_total_snapshot;
    } else {
      throw new DepositAccountError(
        "최종 확정금액이 없습니다. 별도 견적이 필요한 예약은 관리자가 최종 금액을 입력해야 합니다.",
        "FINAL_TOTAL_REQUIRED"
      );
    }

    if (!Number.isFinite(finalTotal) || finalTotal <= 0) {
      throw new DepositAccountError(
        "최종 확정금액이 올바르지 않습니다.",
        "INVALID_FINAL_TOTAL"
      );
    }

    // 5) 예약금 결정 — price_rules.deposit_amount 조회 (이 시점 값을 snapshot으로 고정)
    const houseTypeKey = reservation.house_type_key ?? "";
    let depositAmount = houseTypeKey
      ? await getDepositAmountForHouseType(houseTypeKey)
      : 0;
    depositAmount = Math.round(depositAmount);

    if (!Number.isFinite(depositAmount) || depositAmount < 0) {
      throw new DepositAccountError(
        "예약금이 올바르지 않습니다.",
        "INVALID_DEPOSIT"
      );
    }

    // 6) 금액 검증 — 예약금은 총금액에 포함되므로 총금액을 넘을 수 없다
    if (depositAmount > finalTotal) {
      throw new DepositAccountError(
        `예약금(${depositAmount.toLocaleString("ko-KR")}원)이 ` +
          `최종 금액(${finalTotal.toLocaleString("ko-KR")}원)보다 클 수 없습니다.`,
        "DEPOSIT_EXCEEDS_TOTAL"
      );
    }

    const balanceAmount = finalTotal - depositAmount;
    if (balanceAmount < 0) {
      throw new DepositAccountError("잔금이 음수가 될 수 없습니다.", "NEGATIVE_BALANCE");
    }

    // 7) snapshot 저장 — 이후 계산은 price_rules를 다시 조회하지 않는다.
    //    이 흐름은 고객 셀프 진행이므로 approved_by_admin_id는 기록하지 않는다
    //    (관리자 승인 증빙으로 오인되지 않도록 null 유지).
    await reservationRepo.setDepositSnapshot({
      reservationId,
      depositAmountSnapshot: depositAmount,
      finalConfirmedTotal: finalTotal,
      estimatedBalanceSnapshot: balanceAmount,
    });

    // 8) payment 생성 (snapshot 금액 기준)
    //    입금기한은 계좌 안내 시점부터 24시간 (요구사항 24)
    const dueDate = addHoursISO(DEPOSIT_DEADLINE_HOURS);
    const paymentId = await reservationRepo.insertPayment({
      reservationId,
      amount: depositAmount,
      depositorName: reservation.customer_name,
      dueDate,
    });

    // 9) 상태 전환
    await reservationRepo.setReservationStatusRaw(reservationId, "approved_awaiting_deposit");

    await reservationRepo.insertLog(
      reservationId,
      null,
      "시스템",
      "deposit_account_revealed",
      `예약금 계좌 안내 — 총 ${finalTotal.toLocaleString("ko-KR")}원 / ` +
        `예약금 ${depositAmount.toLocaleString("ko-KR")}원 / ` +
        `잔금 ${balanceAmount.toLocaleString("ko-KR")}원 / 입금기한 ${DEPOSIT_DEADLINE_HOURS}시간` +
        (options?.memo ? ` (${options.memo})` : ""),
      "received",
      "approved_awaiting_deposit"
    );

    return {
      reservationId,
      finalConfirmedTotal: finalTotal,
      depositAmountSnapshot: depositAmount,
      balanceAmount,
      paymentId,
    };
  });
}

export async function confirmPayment(
  reservationId: number,
  adminName: string,
  adminId: number | null,
  memo?: string
) {
  const reservation = await reservationRepo.findReservationById(reservationId);
  if (!reservation) throw new Error("예약을 찾을 수 없습니다.");
  const payment = await reservationRepo.findPaymentByReservationId(reservationId);
  if (!payment) throw new Error("결제 정보를 찾을 수 없습니다.");
  // 신규 흐름(approved_awaiting_deposit)과 기존 데이터(awaiting_deposit) 모두 허용
  const payableStatuses: ReservationStatus[] = ["approved_awaiting_deposit", "awaiting_deposit"];
  if (!payableStatuses.includes(reservation.reservation_status)) {
    throw new Error(`현재 예약 상태(${reservation.reservation_status})에서는 예약금 입금 확인을 처리할 수 없습니다.`);
  }
  if (payment.payment_status !== "pending" && payment.payment_status !== "unconfirmed") {
    throw new Error(`현재 입금 상태(${payment.payment_status})에서는 예약금 입금 확인을 처리할 수 없습니다.`);
  }

  const prevStatus = reservation.reservation_status;

  // 관리자가 실제 입금을 수기로 확인한 시점 = 예약완료 (요구사항 27)
  // 기존 데이터(awaiting_deposit)는 종전대로 awaiting_admin_check을 거친다.
  const nextStatus: ReservationStatus =
    prevStatus === "approved_awaiting_deposit" ? "confirmed" : "awaiting_admin_check";

  // 동시성 방어 — 입금대기 상태일 때만 전이한다.
  // 만료 배치(cancelOverdueReservation)와 동시에 실행돼도 이 UPDATE가 row 배타 잠금을
  // 잡으므로 한쪽만 성공한다. PostgreSQL에서도 동일하게 보장된다.
  const changed = await reservationRepo.compareAndSetReservationStatus(
    reservationId,
    ["approved_awaiting_deposit", "awaiting_deposit"],
    nextStatus
  );
  if (changed === 0) {
    throw new Error(
      "예약 상태가 변경되어 입금 확인을 처리할 수 없습니다. 예약 상태를 다시 확인해주세요."
    );
  }
  await reservationRepo.compareAndSetPaymentConfirmed(reservationId, adminId);
  await reservationRepo.insertLog(
    reservationId,
    adminId,
    adminName,
    "payment_confirmed",
    (nextStatus === "confirmed"
      ? "예약금 입금 확인 완료 / 예약완료"
      : "선입금 확인 완료 / 관리자 예약확정 대기") + (memo ? ` (${memo})` : ""),
    prevStatus,
    nextStatus
  );
}

/**
 * 관리자 최종 예약확정.
 *
 * 조건:
 *   1. payment_status === "confirmed" (선입금 확인 완료)
 *   2. reservation_status === "awaiting_admin_check"
 *
 * 위 조건 미충족 시 Error를 throw합니다.
 */
export async function confirmReservation(
  reservationId: number,
  adminName: string,
  adminId: number | null,
  memo?: string
): Promise<void> {
  const reservation = await reservationRepo.findReservationById(reservationId);
  if (!reservation) throw new Error("예약을 찾을 수 없습니다.");

  const payment = await reservationRepo.findPaymentByReservationId(reservationId);
  if (!payment) throw new Error("결제 정보를 찾을 수 없습니다.");

  if (payment.payment_status !== "confirmed") {
    throw new Error(
      "선입금이 확인되지 않은 예약은 확정할 수 없습니다. 먼저 선입금 확인 처리를 해주세요."
    );
  }
  if (reservation.reservation_status !== "awaiting_admin_check") {
    throw new Error(
      `현재 예약 상태(${reservation.reservation_status})에서는 예약을 확정할 수 없습니다.` +
      " 선입금 확인 완료 후 예약확정이 가능합니다."
    );
  }
  if (reservation.price_confirmed_snapshot === 0 && reservation.final_confirmed_total == null) {
    throw new Error("미확정 견적 예약은 최종 확정금액을 입력한 후 예약을 확정할 수 있습니다.");
  }

  // 슬롯 검증 — 날짜/슬롯이 변경됐거나 capacity가 조정된 경우 재확인
  // 자기 예약은 카운트에서 제외 (본인이 이미 점유 중인 슬롯이므로 빼야 함)
  if (reservation.desired_date && reservation.time_slot &&
      reservation.time_slot !== "all_day") {
    const slot = reservation.time_slot as "morning" | "afternoon";
    const othersCount = await reservationRepo.countActiveReservationsOnSlotExcluding(
      reservation.desired_date,
      slot,
      reservationId
    );
    const view = await getDaySlotView(reservation.desired_date);
    const slotView = slot === "morning" ? view.morning : view.afternoon;

    // 달력 자체가 off(휴무) 또는 상담필요인 경우만 차단
    // "closed"는 자기 예약이 포함된 카운트 기준이므로 여기서 판단하지 않음
    const calStatus = slotView.status; // DB에 저장된 원본 상태
    if (calStatus === "off") {
      throw new Error(
        `${reservation.desired_date} ${slot === "morning" ? "오전" : "오후"} 시간대는 휴무일입니다. 날짜/시간대를 변경해주세요.`
      );
    }
    if (calStatus === "consult_required") {
      throw new Error(
        `${reservation.desired_date} ${slot === "morning" ? "오전" : "오후"} 시간대는 상담 후 예약이 필요합니다.`
      );
    }

    // 다른 예약이 슬롯을 모두 점유한 경우 차단
    if (othersCount >= slotView.capacity) {
      throw new SlotConflictError(reservation.desired_date, slot);
    }
  }

  await reservationRepo.setReservationStatusRaw(reservationId, "confirmed");
  await reservationRepo.insertLog(
    reservationId,
    adminId,
    adminName,
    "reservation_confirmed",
    memo ? `관리자 최종 예약확정 (${memo})` : "관리자 최종 예약확정",
    "awaiting_admin_check",
    "confirmed"
  );
}

const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["unconfirmed"],
  unconfirmed: ["pending"],
  confirmed: ["refund_required"],
  refund_required: ["refunded"],
  refunded: [],
};

export async function updatePaymentStatus(
  reservationId: number,
  status: PaymentStatus,
  adminName: string,
  adminId: number | null
) {
  const payment = await reservationRepo.findPaymentByReservationId(reservationId);
  if (!payment) throw new Error("결제 정보를 찾을 수 없습니다.");

  if (!ALLOWED_PAYMENT_TRANSITIONS[payment.payment_status].includes(status)) {
    throw new Error(
      `허용되지 않는 입금 상태 변경입니다: ${payment.payment_status} -> ${status}. ` +
      "선입금 확인 완료 후에는 pending/unconfirmed 상태로 되돌릴 수 없습니다."
    );
  }

  await reservationRepo.setPaymentStatusByReservationId(reservationId, status);
  await reservationRepo.insertLog(reservationId, adminId, adminName, "payment_status_change", `입금 상태 변경: ${status}`);
}

export async function cancelOverdueReservation(
  reservationId: number,
  adminName = "시스템",
  adminId: number | null = null
) {
  return withTransaction(async () => {
    const res = await reservationRepo.findReservationById(reservationId);
    if (!res) throw new Error("예약을 찾을 수 없습니다.");

    const payment = await reservationRepo.findPaymentByReservationId(reservationId);
    if (!payment) throw new Error("결제 정보를 찾을 수 없습니다.");

    const now = new Date();
    const due = payment.payment_due_date ? new Date(payment.payment_due_date) : null;

    // 신규 흐름(approved_awaiting_deposit)과 기존 데이터(awaiting_deposit) 모두 허용
    const expirableStatuses: ReservationStatus[] = [
      "approved_awaiting_deposit",
      "awaiting_deposit",
    ];
    if (!expirableStatuses.includes(res.reservation_status))
      throw new Error("입금 대기 상태가 아닙니다.");
    if (payment.payment_status !== "pending")
      throw new Error("이미 입금된 예약입니다.");
    if (!due) throw new Error("입금기한이 설정되지 않았습니다.");
    if (now <= due) throw new Error("아직 입금기한이 지나지 않았습니다.");

    const prev = res.reservation_status;

    // 동시성 방어 — 입금대기 상태일 때만 취소로 전이한다.
    // 관리자 입금확인(confirmPayment)이 먼저 커밋됐다면 여기서 0이 반환되어
    // confirmed가 cancelled로 덮어써지지 않는다. PostgreSQL row lock 기준.
    const changed = await reservationRepo.compareAndSetReservationStatus(
      reservationId,
      ["approved_awaiting_deposit", "awaiting_deposit"],
      "cancelled"
    );
    if (changed === 0) {
      throw new Error("예약 상태가 변경되어 만료 처리를 진행하지 않았습니다.");
    }

    // 만료 이력 기록 — 예약 row는 삭제하지 않는다 (요구사항 26)
    await reservationRepo.markDepositExpired(reservationId);
    await reservationRepo.markPendingPaymentAsUnconfirmedByReservationId(reservationId);
    await reservationRepo.insertLog(
      reservationId,
      adminId,
      adminName,
      "auto_cancel",
      `입금기한(${DEPOSIT_DEADLINE_HOURS}시간) 초과 자동 취소 — 슬롯이 해제되고 예약 기록은 보존됩니다.`,
      prev,
      "cancelled"
    );
  });
}

// ---------------------------------------------------------------------------
// 예약 시간대 변경 (관리자) — 수정 6번
//
// 검증:
//   - 본인 예약은 카운트에서 제외하고 목표 슬롯 잔여석 확인
//   - 날짜 차단(off/closed) 반영
//   - 다른 예약이 점유한 슬롯이면 409
// ---------------------------------------------------------------------------

export class SlotConflictError extends Error {
  constructor(date: string, timeSlot: "morning" | "afternoon") {
    super(
      `${date} ${timeSlot === "morning" ? "오전" : "오후"} 시간대는 이미 다른 예약이 있습니다.`
    );
  }
}

export async function changeReservationSlot(
  reservationId: number,
  newDate: string,
  newTimeSlot: "morning" | "afternoon",
  adminName: string,
  adminId: number | null
): Promise<void> {
  const current = await reservationRepo.findReservationById(reservationId);
  if (!current) throw new Error("예약을 찾을 수 없습니다.");

  await withTransaction(async () => {
    await lockReservationSlot(newDate, newTimeSlot);
    // 목표 슬롯 상태 확인
    const view = await getDaySlotView(newDate);
    const slotView = newTimeSlot === "morning" ? view.morning : view.afternoon;

    if (slotView.effectiveStatus === "off") {
      throw new DateNotAvailableError(newDate, "off");
    }
    if (slotView.effectiveStatus === "consult_required") {
      throw new DateNotAvailableError(newDate, "consult_required");
    }

    // 자기 예약을 제외한 카운트로 잔여석 재계산
    const othersCount = await reservationRepo.countActiveReservationsOnSlotExcluding(
      newDate,
      newTimeSlot,
      reservationId
    );
    const capacity = slotView.capacity;
    if (othersCount >= capacity) {
      throw new SlotConflictError(newDate, newTimeSlot);
    }

    const prevInfo = `${current.desired_date ?? "?"}/${current.time_slot}`;
    const nextInfo = `${newDate}/${newTimeSlot}`;

    await reservationRepo.setReservationSlot(reservationId, newDate, newTimeSlot);
    await reservationRepo.insertLog(
      reservationId,
      adminId,
      adminName,
      "slot_change",
      `시간대 변경: ${prevInfo} → ${nextInfo}`
    );

  });
}

// ---------------------------------------------------------------------------
// 대시보드 통계
// ---------------------------------------------------------------------------

export async function getDashboardStats() {
  const [total, received, awaitingDeposit, confirmed, consultRequired, cancelled, completed] = await Promise.all([
    reservationRepo.countAll(),
    reservationRepo.countByStatus("received"),
    reservationRepo.countByStatus("awaiting_deposit"),
    reservationRepo.countByStatus("confirmed"),
    reservationRepo.countByStatus("consult_required"),
    reservationRepo.countByStatus("cancelled"),
    reservationRepo.countByStatus("completed"),
  ]);
  return { total, received, awaitingDeposit, confirmed, consultRequired, cancelled, completed };
}

// ---------------------------------------------------------------------------
// 입금기한 만료 일괄 처리 (요구사항 25·26)
//
// 기존 cancelOverdueReservation()을 그대로 재사용한다 (중복 스케줄러/로직 없음).
// 계좌 API, 캘린더 조회, 예약 생성 등 자연스러운 트래픽 시점에 lazy 호출된다.
//
// 처리 내용 (건별 트랜잭션):
//   deposit_expired_at 기록 + auto_released = 1
//   + reservation_status = cancelled (슬롯 해제 → 공개상태 "예약가능")
//   + pending payment를 unconfirmed로 정리
//   예약 row는 삭제하지 않는다.
// ---------------------------------------------------------------------------
export async function releaseExpiredDepositReservations(): Promise<number> {
  const expired = await reservationRepo.findExpiredUnpaidReservations();
  if (expired.length === 0) return 0;

  let released = 0;
  for (const row of expired) {
    try {
      await cancelOverdueReservation(row.id, "시스템", null);
      released += 1;
    } catch {
      // 그 사이 입금확인됐거나 이미 처리된 건은 건너뛴다
    }
  }
  return released;
}
