import * as reservationRepo from "@/database/repositories/reservation-repository";
import { lockReservationSlot, withTransaction } from "@/database/connection";
import { generateReservationCode, addHoursISO } from "./utils";
import { getSlotEffectiveStatus, getDaySlotView } from "./calendar";
import { getPricingSettings, getBankSettings, checkReservationReadiness } from "./settings";
import { calculateQuote } from "./pricing";
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
}

export interface CreateReservationResult {
  reservation: Reservation;
  payment: Payment;
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

  const [pricing, bank] = await Promise.all([getPricingSettings(), getBankSettings()]);
  const code = generateReservationCode();
  const dueDate = addHoursISO(bank.paymentDueHours);

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
    });

    await reservationRepo.setReservationStatusRaw(reservationId, "awaiting_deposit");

    await reservationRepo.insertPayment({
      reservationId,
      amount: pricing.depositAmount,
      depositorName: input.depositorName,
      dueDate,
    });

    await reservationRepo.insertLog(
      reservationId,
      null,
      "시스템",
      "reservation_created",
      `예약 접수 (경로: ${input.entryRoute}, 슬롯: ${input.timeSlot}, 할인자격: ${eligible})`
    );

  });

  const reservation = await reservationRepo.findReservationById(reservationId);
  const payment = await reservationRepo.findPaymentByReservationId(reservationId);
  if (!reservation || !payment) throw new Error("예약 생성 결과를 찾을 수 없습니다.");

  return { reservation, payment };
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

const ALLOWED_RESERVATION_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  received: ["awaiting_deposit", "consult_required", "cancelled"],
  awaiting_deposit: ["consult_required", "cancelled"],
  awaiting_admin_check: ["consult_required", "cancelled"],
  confirmed: ["completed", "cancelled"],
  consult_required: ["awaiting_deposit", "cancelled"],
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
  if (reservation.reservation_status !== "awaiting_deposit") {
    throw new Error(`현재 예약 상태(${reservation.reservation_status})에서는 선입금 확인을 처리할 수 없습니다.`);
  }
  if (payment.payment_status !== "pending" && payment.payment_status !== "unconfirmed") {
    throw new Error(`현재 입금 상태(${payment.payment_status})에서는 선입금 확인을 처리할 수 없습니다.`);
  }

  await reservationRepo.confirmPaymentRow(reservationId, adminId);
  // 선입금 확인만으로 최종 예약확정이 아님 — awaiting_admin_check으로 이동
  await reservationRepo.setReservationStatusRaw(reservationId, "awaiting_admin_check");
  await reservationRepo.insertLog(
    reservationId,
    adminId,
    adminName,
    "payment_confirmed",
    memo
      ? `선입금 확인 완료 / 관리자 예약확정 대기 (${memo})`
      : "선입금 확인 완료 / 관리자 예약확정 대기",
    "awaiting_deposit",
    "awaiting_admin_check"
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
  const res = await reservationRepo.findReservationById(reservationId);
  if (!res) throw new Error("예약을 찾을 수 없습니다.");

  const payment = await reservationRepo.findPaymentByReservationId(reservationId);
  if (!payment) throw new Error("결제 정보를 찾을 수 없습니다.");

  const now = new Date();
  const due = payment.payment_due_date ? new Date(payment.payment_due_date) : null;

  if (res.reservation_status !== "awaiting_deposit")
    throw new Error("입금 대기 상태가 아닙니다.");
  if (payment.payment_status !== "pending")
    throw new Error("이미 입금된 예약입니다.");
  if (!due) throw new Error("입금기한이 설정되지 않았습니다.");
  if (now <= due) throw new Error("아직 입금기한이 지나지 않았습니다.");

  await reservationRepo.setReservationStatusRaw(reservationId, "cancelled");
  await reservationRepo.markPendingPaymentAsUnconfirmedByReservationId(reservationId);
  await reservationRepo.insertLog(
    reservationId,
    adminId,
    adminName,
    "auto_cancel",
    "입금기한 초과 자동 취소"
  );
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
