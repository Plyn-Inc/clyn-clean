import { execute, executeReturningCount, insertReturningId, queryRow, queryRows, getDatabaseBackend } from "../connection";
import type { Reservation, Payment, ReservationStatus, PaymentStatus, ConfirmationLog } from "@/lib/types";

export interface CreateReservationRow {
  code: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  serviceType: string;
  region: string;
  address: string;
  areaPyeong: number | null;
  houseTypeKey: string | null;
  priceMultiplier: number;
  houseStructure: string | null;
  occupancyStatus: string | null;
  desiredDate: string | null;
  timeSlot: string;
  entryRoute: string;
  extraOptions: string;
  extraNotes: string | null;
  hasSitePhotos: number;
  basePriceSnapshot: number | null;
  extraPriceSnapshot: number | null;
  optionBreakdownSnapshot: string | null;
  depositAmountSnapshot: number | null;
  instantDiscountSnapshot: number | null;
  estimatedTotalSnapshot: number | null;
  estimatedBalanceSnapshot: number | null;
  priceConfirmedSnapshot: number;
  instantDiscountEligible: number;
  privacyAgreed: number;
  // --- 최소 고객정보: 작업지역 ---
  areaSido: string | null;
  areaSigungu: string | null;
  areaDong: string | null;
  // --- 서비스 3종 동의 (각각 저장) ---
  corePrinciplesAgreed: number;
  serviceTermsAgreed: number;
  additionalChargeAgreed: number;
  /** 3종 동의 완료 시에만 값이 들어간다 */
  agreementVersion: string | null;
  /** 반려동물 있음 (legacy — 신규 예약에서는 항상 0) */
  hasPet: number;
  // --- 20260914 개편: 서비스별 독립 가격 snapshot ---
  /** 상품 키 (주거형태/평형/집정리 패키지) */
  productKey: string | null;
  /** 휴일 가산금 snapshot (일요일/공휴일 1회) */
  holidaySurchargeSnapshot: number;
  /** 총 예약금액 = 기본가격 + 휴일 가산금 */
  totalAmountSnapshot: number | null;
  // --- 사이청소 전용 시간 (extra_notes JSON 의존 제거) ---
  moveOutTime: string | null;
  moveInTime: string | null;
  // --- 행정구역 code snapshot ---
  areaSidoCode: string | null;
  areaSigunguCode: string | null;
  areaDongCode: string | null;
  /** 예약 제출 idempotency 키 (견적 토큰의 quoteId) */
  quoteId?: string | null;
  /** 날짜 조건 가격 보정 내부 감사용 */
  dateAdjustmentApplied: number;
  dateAdjustmentAmount: number;
  /** 신규 단순 접수 흐름에서 insert 시점에 바로 확정할 snapshot */
  finalConfirmedTotal?: number | null;
  /** 계좌를 동일 응답으로 안내하므로 insert 시각을 공개시각으로 기록 */
  accountRevealed?: boolean;
  /** 기본 received, 신규 고객 접수는 awaiting_deposit */
  reservationStatus?: ReservationStatus;
}

export function insertReservation(row: CreateReservationRow): Promise<number> {
  return insertReturningId(
    `INSERT INTO reservations (
      reservation_code, customer_name, customer_phone, customer_email,
      service_type, region, address, area_pyeong, house_type_key, price_multiplier, house_structure,
      occupancy_status, desired_date, time_slot, entry_route,
      extra_options, extra_notes, has_site_photos,
      base_price_snapshot, extra_price_snapshot, option_breakdown_snapshot, deposit_amount_snapshot, instant_discount_snapshot,
      estimated_total_snapshot, estimated_balance_snapshot,
      price_confirmed_snapshot,
      instant_discount_eligible, instant_discount_applied,
      privacy_agreed, privacy_agreed_at,
      area_sido, area_sigungu, area_dong,
      core_principles_agreed, service_terms_agreed, additional_charge_agreed,
      agreement_version, agreed_at,
      has_pet, date_adjustment_applied, date_adjustment_amount,
      product_key, holiday_surcharge_snapshot, total_amount_snapshot,
      move_out_time, move_in_time,
      area_sido_code, area_sigungu_code, area_dong_code, quote_id,
      final_confirmed_total, account_revealed_at, reservation_status
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
      ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
      ?, ?, ?,
      ?, ?, ?,
      ?, CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, ?
    )`,
    [
      row.code, row.customerName, row.customerPhone, row.customerEmail,
      row.serviceType, row.region, row.address, row.areaPyeong, row.houseTypeKey, row.priceMultiplier, row.houseStructure,
      row.occupancyStatus, row.desiredDate, row.timeSlot, row.entryRoute,
      row.extraOptions, row.extraNotes, row.hasSitePhotos,
      row.basePriceSnapshot, row.extraPriceSnapshot, row.optionBreakdownSnapshot, row.depositAmountSnapshot, row.instantDiscountSnapshot,
      row.estimatedTotalSnapshot, row.estimatedBalanceSnapshot,
      row.priceConfirmedSnapshot, row.instantDiscountEligible,
      row.privacyAgreed, row.privacyAgreed,
      row.areaSido, row.areaSigungu, row.areaDong,
      row.corePrinciplesAgreed, row.serviceTermsAgreed, row.additionalChargeAgreed,
      row.agreementVersion, row.agreementVersion,
      row.hasPet, row.dateAdjustmentApplied, row.dateAdjustmentAmount,
      row.productKey, row.holidaySurchargeSnapshot, row.totalAmountSnapshot,
      row.moveOutTime, row.moveInTime,
      row.areaSidoCode, row.areaSigunguCode, row.areaDongCode, row.quoteId ?? null,
      row.finalConfirmedTotal ?? null, row.accountRevealed ? 1 : 0, row.reservationStatus ?? "received",
    ]
  );
}



export interface InsertReservationBundlePostgresParams {
  reservation: CreateReservationRow;
  payment: {
    amount: number;
    depositorName: string;
    dueDate: string;
  };
  historyDetail: string;
}

/**
 * PostgreSQL production booking write.
 *
 * Vercel/Supabase 환경에서 explicit BEGIN 자체가 실패해 insert에 도달하지 못하는
 * 경로를 피하기 위해 예약 + pending payment + 관리자 이력을 한 statement로 저장한다.
 * PostgreSQL의 단일 statement는 원자적이므로 세 CTE 중 하나가 실패하면 전체가 반영되지 않는다.
 * SQLite에서는 이 함수를 호출하지 않고 기존 withTransaction 경로를 사용한다.
 */
export async function insertReservationBundlePostgres(
  params: InsertReservationBundlePostgresParams
): Promise<{ reservationId: number; paymentId: number; logId: number }> {
  const row = params.reservation;
  const result = await queryRow<{
    reservation_id: number | string;
    payment_id: number | string;
    log_id: number | string;
  }>(
    `WITH inserted_reservation AS (
      INSERT INTO reservations (
        reservation_code, customer_name, customer_phone, customer_email,
        service_type, region, address, area_pyeong, house_type_key, price_multiplier, house_structure,
        occupancy_status, desired_date, time_slot, entry_route,
        extra_options, extra_notes, has_site_photos,
        base_price_snapshot, extra_price_snapshot, option_breakdown_snapshot, deposit_amount_snapshot, instant_discount_snapshot,
        estimated_total_snapshot, estimated_balance_snapshot,
        price_confirmed_snapshot,
        instant_discount_eligible, instant_discount_applied,
        privacy_agreed, privacy_agreed_at,
        area_sido, area_sigungu, area_dong,
        core_principles_agreed, service_terms_agreed, additional_charge_agreed,
        agreement_version, agreed_at,
        has_pet, date_adjustment_applied, date_adjustment_amount,
        product_key, holiday_surcharge_snapshot, total_amount_snapshot,
        move_out_time, move_in_time,
        area_sido_code, area_sigungu_code, area_dong_code, quote_id,
        final_confirmed_total, account_revealed_at, reservation_status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
        ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
        ?, ?, ?,
        ?, ?, ?,
        ?, CASE WHEN ?::text IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, ?
      )
      RETURNING id
    ), inserted_payment AS (
      INSERT INTO payments (
        reservation_id, payment_method, payment_status, amount, depositor_name, payment_due_date
      )
      SELECT id, 'manual_bank_transfer', 'pending', ?, ?, ?
      FROM inserted_reservation
      RETURNING id, reservation_id
    ), inserted_log AS (
      INSERT INTO confirmation_logs (
        reservation_id, admin_id, admin_name, action, detail, prev_status, next_status
      )
      SELECT reservation_id, NULL, '시스템', 'reservation_received', ?, NULL, 'awaiting_deposit'
      FROM inserted_payment
      RETURNING id
    )
    SELECT
      (SELECT id FROM inserted_reservation) AS reservation_id,
      (SELECT id FROM inserted_payment) AS payment_id,
      (SELECT id FROM inserted_log) AS log_id`,
    [
      row.code, row.customerName, row.customerPhone, row.customerEmail,
      row.serviceType, row.region, row.address, row.areaPyeong, row.houseTypeKey, row.priceMultiplier, row.houseStructure,
      row.occupancyStatus, row.desiredDate, row.timeSlot, row.entryRoute,
      row.extraOptions, row.extraNotes, row.hasSitePhotos,
      row.basePriceSnapshot, row.extraPriceSnapshot, row.optionBreakdownSnapshot, row.depositAmountSnapshot, row.instantDiscountSnapshot,
      row.estimatedTotalSnapshot, row.estimatedBalanceSnapshot,
      row.priceConfirmedSnapshot, row.instantDiscountEligible,
      row.privacyAgreed, row.privacyAgreed,
      row.areaSido, row.areaSigungu, row.areaDong,
      row.corePrinciplesAgreed, row.serviceTermsAgreed, row.additionalChargeAgreed,
      row.agreementVersion, row.agreementVersion,
      row.hasPet, row.dateAdjustmentApplied, row.dateAdjustmentAmount,
      row.productKey, row.holidaySurchargeSnapshot, row.totalAmountSnapshot,
      row.moveOutTime, row.moveInTime,
      row.areaSidoCode, row.areaSigunguCode, row.areaDongCode, row.quoteId ?? null,
      row.finalConfirmedTotal ?? null, row.accountRevealed ? 1 : 0, row.reservationStatus ?? "received",
      params.payment.amount, params.payment.depositorName, params.payment.dueDate,
      params.historyDetail,
    ]
  );

  if (!result) throw new Error("Atomic booking insert did not return ids.");
  return {
    reservationId: Number(result.reservation_id),
    paymentId: Number(result.payment_id),
    logId: Number(result.log_id),
  };
}

export function setReservationStatusRaw(id: number, status: ReservationStatus): Promise<void> {
  return execute(`UPDATE reservations SET reservation_status = ?, updated_at = datetime('now') WHERE id = ?`, [status, id]);
}

export function setInstantDiscountApplied(id: number, applied: boolean): Promise<void> {
  return execute(`UPDATE reservations SET instant_discount_applied = ?, updated_at = datetime('now') WHERE id = ?`, [applied ? 1 : 0, id]);
}

export function setAdminMemo(id: number, memo: string): Promise<void> {
  return execute(`UPDATE reservations SET admin_memo = ?, updated_at = datetime('now') WHERE id = ?`, [memo, id]);
}

export function setFinalConfirmedTotal(id: number, amount: number): Promise<void> {
  return execute(`UPDATE reservations SET final_confirmed_total = ?, updated_at = datetime('now') WHERE id = ?`, [amount, id]);
}

export function findReservationById(id: number): Promise<Reservation | undefined> {
  return queryRow<Reservation>("SELECT * FROM reservations WHERE id = ?", [id]);
}

export function findReservationByCode(code: string): Promise<Reservation | undefined> {
  return queryRow<Reservation>("SELECT * FROM reservations WHERE reservation_code = ?", [code]);
}

export function listReservationsWithPayment(filter?: {
  status?: ReservationStatus;
  paymentStatus?: PaymentStatus;
  search?: string;
}): Promise<(Reservation & { payment_status: PaymentStatus; amount: number; depositor_name: string | null })[]> {
  let query = `
    SELECT r.*, p.payment_status as payment_status, p.amount as amount, p.depositor_name as depositor_name
    FROM reservations r
    LEFT JOIN payments p ON p.reservation_id = r.id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (filter?.status) { query += " AND r.reservation_status = ?"; params.push(filter.status); }
  if (filter?.paymentStatus) { query += " AND p.payment_status = ?"; params.push(filter.paymentStatus); }
  if (filter?.search) {
    query += " AND (r.customer_name LIKE ? OR r.customer_phone LIKE ? OR r.reservation_code LIKE ?)";
    const s = `%${filter.search}%`;
    params.push(s, s, s);
  }
  query += " ORDER BY r.created_at DESC";
  return queryRows<Reservation & { payment_status: PaymentStatus; amount: number; depositor_name: string | null }>(query, params);
}

export function listOverdueUnpaidReservations(): Promise<(Reservation & { payment_due_date: string | null })[]> {
  return queryRows<Reservation & { payment_due_date: string | null }>(
    `SELECT r.*, p.payment_due_date as payment_due_date
     FROM reservations r
     JOIN payments p ON p.reservation_id = r.id
     WHERE r.reservation_status IN ('received', 'awaiting_deposit')
       AND p.payment_status = 'pending'
       AND p.payment_due_date IS NOT NULL
       AND p.payment_due_date < datetime('now')`
  );
}

export function insertPayment(params: { reservationId: number; amount: number; depositorName: string; dueDate: string; }): Promise<number> {
  return insertReturningId(
    `INSERT INTO payments (reservation_id, payment_method, payment_status, amount, depositor_name, payment_due_date)
     VALUES (?, 'manual_bank_transfer', 'pending', ?, ?, ?)`,
    [params.reservationId, params.amount, params.depositorName, params.dueDate]
  );
}

/**
 * 해당 예약에 연결된 payment 개수. 중복 승인/중복 payment 방어에 사용한다.
 */
export async function countPaymentsByReservationId(reservationId: number): Promise<number> {
  const row = await queryRow<{ c: number }>(
    "SELECT COUNT(*) as c FROM payments WHERE reservation_id = ?",
    [reservationId]
  );
  return Number(row?.c ?? 0);
}

/**
 * 예약금 계좌 공개 시점의 예약금/최종금액/잔금 snapshot을 예약에 기록한다.
 * 이후 모든 계산은 price_rules를 다시 조회하지 않고 이 snapshot을 사용한다.
 *
 * account_revealed_at은 입금기한 24시간의 기준 시각이다.
 * 이 흐름은 고객 셀프 진행이므로 approved_by_admin_id는 기록하지 않는다.
 */
/**
 * 입금기한이 지난 미입금 예약을 찾아 만료 처리 대상으로 반환한다.
 * 아직 만료 이력이 기록되지 않은 건만 대상으로 한다.
 */
export function findExpiredUnpaidReservations(): Promise<
  { id: number; desired_date: string | null; time_slot: string }[]
> {
  return queryRows(
    `SELECT rs.id, rs.desired_date, rs.time_slot
       FROM reservations rs
      WHERE rs.reservation_status IN ('awaiting_deposit','approved_awaiting_deposit')
        AND rs.auto_released = 0
        AND EXISTS (
          SELECT 1 FROM payments p
           WHERE p.reservation_id = rs.id
             AND p.payment_status = 'pending'
             AND p.payment_due_date IS NOT NULL
             AND p.payment_due_date < datetime('now')
        )`
  );
}

/**
 * 동시성 방어 — 조건부 atomic 상태 전이.
 *
 * 지정한 현재 상태(expectedStatuses)일 때만 nextStatus로 바꾸고, 변경된 행 수를 반환한다.
 * 0이면 그 사이 다른 트랜잭션이 상태를 바꾼 것이므로 호출부가 처리를 중단해야 한다.
 *
 * PostgreSQL에서 이 UPDATE는 해당 row에 행 수준 배타 잠금을 걸므로,
 * confirmPayment()와 cancelOverdueReservation()이 동시에 실행돼도
 * 하나만 성공하고 나머지는 0을 받는다. (SQLite 직렬화에 의존하지 않는다)
 */
export async function compareAndSetReservationStatus(
  reservationId: number,
  expectedStatuses: ReservationStatus[],
  nextStatus: ReservationStatus
): Promise<number> {
  const placeholders = expectedStatuses.map(() => "?").join(", ");
  return executeReturningCount(
    `UPDATE reservations
        SET reservation_status = ?, updated_at = datetime('now')
      WHERE id = ?
        AND reservation_status IN (${placeholders})`,
    [nextStatus, reservationId, ...expectedStatuses]
  );
}

/**
 * 동시성 방어 — pending 결제만 confirmed로 전이한다.
 * 이미 unconfirmed(만료 처리됨)이면 0을 반환한다.
 */
export async function compareAndSetPaymentConfirmed(
  reservationId: number,
  adminId: number | null
): Promise<number> {
  return executeReturningCount(
    `UPDATE payments
        SET payment_status = 'confirmed',
            confirmed_at = datetime('now'),
            confirmed_by_admin_id = ?,
            updated_at = datetime('now')
      WHERE reservation_id = ?
        AND payment_status IN ('pending', 'unconfirmed')`,
    [adminId, reservationId]
  );
}

/**
 * 입금기한 만료 이력을 기록한다.
 * 예약 row는 삭제하지 않는다 (요구사항 26 — 고객 문의/관리자 이력용).
 */
export function markDepositExpired(reservationId: number): Promise<void> {
  return execute(
    `UPDATE reservations
        SET deposit_expired_at = datetime('now'),
            auto_released = 1,
            updated_at = datetime('now')
      WHERE id = ?`,
    [reservationId]
  );
}

export function setDepositSnapshot(params: {
  reservationId: number;
  depositAmountSnapshot: number;
  finalConfirmedTotal: number;
  estimatedBalanceSnapshot: number;
}): Promise<void> {
  return execute(
    `UPDATE reservations
        SET deposit_amount_snapshot = ?,
            final_confirmed_total = ?,
            estimated_balance_snapshot = ?,
            account_revealed_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ?`,
    [
      params.depositAmountSnapshot,
      params.finalConfirmedTotal,
      params.estimatedBalanceSnapshot,
      params.reservationId,
    ]
  );
}

export function findPaymentByReservationId(reservationId: number): Promise<Payment | undefined> {
  return queryRow<Payment>("SELECT * FROM payments WHERE reservation_id = ? ORDER BY id DESC LIMIT 1", [reservationId]);
}

export function setPaymentConfirmed(paymentId: number, adminId: number | null): Promise<void> {
  return execute(
    `UPDATE payments SET payment_status = 'confirmed', confirmed_at = datetime('now'), confirmed_by_admin_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [adminId, paymentId]
  );
}

export function setPaymentStatus(paymentId: number, status: PaymentStatus): Promise<void> {
  return execute(`UPDATE payments SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`, [status, paymentId]);
}

export function setPaymentStatusByReservationId(reservationId: number, status: PaymentStatus): Promise<void> {
  return execute(`UPDATE payments SET payment_status = ?, updated_at = datetime('now') WHERE reservation_id = ?`, [status, reservationId]);
}

export function markPendingPaymentAsUnconfirmedByReservationId(reservationId: number): Promise<void> {
  return execute(
    `UPDATE payments SET payment_status = 'unconfirmed', updated_at = datetime('now')
     WHERE reservation_id = ? AND payment_status = 'pending'`,
    [reservationId]
  );
}

export function insertLog(
  reservationId: number,
  adminId: number | null,
  adminName: string,
  action: string,
  detail?: string,
  prevStatus?: string,
  nextStatus?: string
): Promise<number> {
  return insertReturningId(
    `INSERT INTO confirmation_logs (reservation_id, admin_id, admin_name, action, detail, prev_status, next_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reservationId, adminId, adminName, action, detail ?? null, prevStatus ?? null, nextStatus ?? null]
  );
}

export function setReservationSlot(reservationId: number, newDate: string, newTimeSlot: "morning" | "afternoon"): Promise<void> {
  return execute(
    `UPDATE reservations SET desired_date = ?, time_slot = ?, updated_at = datetime('now') WHERE id = ?`,
    [newDate, newTimeSlot, reservationId]
  );
}

export async function countDirectActiveReservationsOnSlotExcluding(
  date: string,
  timeSlot: "morning" | "afternoon",
  excludeReservationId: number
): Promise<number> {
  const row = await queryRow<{ c: number | string }>(
    `SELECT COUNT(*) as c FROM reservations rs
     WHERE rs.desired_date = ?
       AND rs.time_slot = ?
       AND rs.reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')
       AND rs.id != ?
       AND NOT (
         rs.reservation_status IN ('awaiting_deposit','approved_awaiting_deposit')
         AND EXISTS (
           SELECT 1 FROM payments p
           WHERE p.reservation_id = rs.id
             AND p.payment_status = 'pending'
             AND p.payment_due_date IS NOT NULL
             AND p.payment_due_date < datetime('now')
         )
       )`,
    [date, timeSlot, excludeReservationId]
  );
  return Number(row?.c ?? 0);
}

export async function countActiveReservationsOnSlotExcluding(
  date: string,
  timeSlot: "morning" | "afternoon",
  excludeReservationId: number
): Promise<number> {
  const row = await queryRow<{ c: number | string }>(
    `SELECT COUNT(*) as c FROM reservations rs
     WHERE rs.desired_date = ?
       AND (rs.time_slot = ? OR rs.time_slot = 'all_day')
       AND rs.reservation_status IN ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')
       AND rs.id != ?
       AND NOT (
         rs.reservation_status = 'awaiting_deposit'
         AND EXISTS (
           SELECT 1 FROM payments p
           WHERE p.reservation_id = rs.id
             AND p.payment_status = 'pending'
             AND p.payment_due_date IS NOT NULL
             AND p.payment_due_date < datetime('now')
         )
       )`,
    [date, timeSlot, excludeReservationId]
  );
  return Number(row?.c ?? 0);
}

export async function confirmPaymentRow(reservationId: number, adminId: number | null): Promise<void> {
  const payment = await findPaymentByReservationId(reservationId);
  if (!payment) throw new Error("결제 정보를 찾을 수 없습니다.");
  await setPaymentConfirmed(payment.id, adminId);
}

export function findLogsByReservationId(reservationId: number): Promise<ConfirmationLog[]> {
  return queryRows<ConfirmationLog>(
    "SELECT * FROM confirmation_logs WHERE reservation_id = ? ORDER BY created_at DESC",
    [reservationId]
  );
}

export async function getDashboardStatsAggregate(): Promise<{
  total: number;
  received: number;
  awaitingDeposit: number;
  confirmed: number;
  consultRequired: number;
  cancelled: number;
  completed: number;
}> {
  const row = await queryRow<{
    total: number | string;
    received: number | string;
    awaiting_deposit: number | string;
    confirmed: number | string;
    consult_required: number | string;
    cancelled: number | string;
    completed: number | string;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN reservation_status = 'received' THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN reservation_status = 'awaiting_deposit' THEN 1 ELSE 0 END) AS awaiting_deposit,
      SUM(CASE WHEN reservation_status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN reservation_status = 'consult_required' THEN 1 ELSE 0 END) AS consult_required,
      SUM(CASE WHEN reservation_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN reservation_status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM reservations
  `);

  return {
    total: Number(row?.total ?? 0),
    received: Number(row?.received ?? 0),
    awaitingDeposit: Number(row?.awaiting_deposit ?? 0),
    confirmed: Number(row?.confirmed ?? 0),
    consultRequired: Number(row?.consult_required ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    completed: Number(row?.completed ?? 0),
  };
}

export async function countByStatus(status: ReservationStatus): Promise<number> {
  const row = await queryRow<{ c: number | string }>("SELECT COUNT(*) as c FROM reservations WHERE reservation_status = ?", [status]);
  return Number(row?.c ?? 0);
}

export async function countAll(): Promise<number> {
  const row = await queryRow<{ c: number | string }>("SELECT COUNT(*) as c FROM reservations");
  return Number(row?.c ?? 0);
}

/**
 * quoteId로 기존 예약을 찾는다 (예약 제출 idempotency).
 *
 * 같은 견적으로 재요청이 오면 새 예약을 만들지 않고 이 결과를 반환한다.
 */
export async function findReservationByQuoteId(
  quoteId: string
): Promise<(Reservation & { payment_id: number | null; payment_due_date: string | null }) | undefined> {
  return queryRow<Reservation & { payment_id: number | null; payment_due_date: string | null }>(
    `SELECT r.*, p.id AS payment_id, p.payment_due_date AS payment_due_date
       FROM reservations r
       LEFT JOIN payments p ON p.reservation_id = r.id
      WHERE r.quote_id = ?
      ORDER BY r.id ASC
      LIMIT 1`,
    [quoteId]
  );
}

/**
 * unique violation 여부.
 *
 * idempotency 경합으로 취급할 오류만 좁게 인식한다.
 * timeout / connection failure / syntax error를 unique violation으로 오판하면
 * 실제 장애가 "정상 재요청"으로 둔갑하므로 조건을 넓히지 않는다.
 */
export function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: string; message?: string };

  // PostgreSQL: 23505 unique_violation
  if (err.code === "23505") return true;

  // SQLite: node:sqlite는 ERR_SQLITE_ERROR + 명시적 메시지를 준다
  if (err.code === "ERR_SQLITE_ERROR" || err.code === undefined) {
    return /UNIQUE constraint failed/i.test(String(err.message ?? ""));
  }
  return false;
}

/** 슬롯이 이미 점유됐을 때 던지는 오류 */
export class SlotConflictError extends Error {
  code = "SLOT_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "SlotConflictError";
  }
}

/**
 * 예약 저장 직전 슬롯 충돌 최소 방어.
 *
 * 기존 capacity 정책을 그대로 따른다:
 *   - capacity는 슬롯별이다 (calendar_days PK = date + time_slot)
 *   - 해당 슬롯 row가 없으면 settings.default_daily_capacity를 쓴다
 *   - all_day row가 있으면 그 값을 슬롯 기본값으로 쓴다 (calendar.ts와 동일 규칙)
 *
 * capacity=1을 하드코딩하지 않는다. 오전 capacity 2면 2건까지 받는다.
 *
 * 동시성: PostgreSQL advisory transaction lock으로 같은 날짜 저장을 직렬화한다.
 * lock · capacity 조회 · active count · INSERT가 모두 같은 트랜잭션 안에서
 * 실행되어야 한다 (호출부가 withTransaction / 단일 statement 안에서 부른다).
 *
 * 조회는 calendar_days 2행 + settings 1건 + count 1건뿐이다.
 * 캘린더 전체 조회나 가격 재계산은 하지 않는다.
 */
const ACTIVE_STATUSES =
  `('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed')`;

async function effectiveCapacity(date: string, timeSlot: string): Promise<number> {
  const rows = await queryRows<{ time_slot: string; capacity: number; status: string }>(
    `SELECT time_slot, capacity, status FROM calendar_days
      WHERE date = ? AND time_slot IN (?, 'all_day')`,
    [date, timeSlot]
  );
  const slotRow = rows.find((r) => r.time_slot === timeSlot);
  const allDayRow = rows.find((r) => r.time_slot === "all_day");

  // 관리자가 닫은 슬롯은 capacity와 무관하게 접수 불가
  const status = allDayRow?.status ?? slotRow?.status ?? "available";
  if (status !== "available") return 0;

  if (slotRow?.capacity != null) return Number(slotRow.capacity);
  if (allDayRow?.capacity != null) return Number(allDayRow.capacity);

  const setting = await queryRow<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'default_daily_capacity'",
    []
  );
  const v = Number(setting?.value ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export async function assertSlotAvailableForInsert(
  date: string,
  timeSlot: string
): Promise<void> {
  if (getDatabaseBackend() === "postgres") {
    // 같은 날짜 저장을 직렬화한다. all_day와 오전/오후가 서로 배타적이므로
    // 슬롯이 아니라 날짜 단위로 잠근다.
    await queryRows(
      "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
      [`clyn-clean:slot-insert:${date}`]
    );
  }

  if (timeSlot === "all_day") {
    // 사이청소는 종일 점유 — 그날 활성 예약이 하나라도 있으면 접수 불가
    const row = await queryRow<{ c: number }>(
      `SELECT COUNT(*) AS c FROM reservations
        WHERE desired_date = ? AND reservation_status IN ${ACTIVE_STATUSES}`,
      [date]
    );
    if (Number(row?.c ?? 0) > 0) {
      throw new SlotConflictError("선택하신 날짜에 이미 예약이 있습니다. 다른 날짜를 선택해주세요.");
    }
    // all_day 자체도 capacity가 0이면(관리자 마감) 접수 불가
    if ((await effectiveCapacity(date, "all_day")) <= 0) {
      throw new SlotConflictError("선택하신 날짜는 예약할 수 없습니다. 다른 날짜를 선택해주세요.");
    }
    return;
  }

  // 일반 예약 — 그날 all_day(사이청소) 점유가 있으면 차단
  const allDayTaken = await queryRow<{ c: number }>(
    `SELECT COUNT(*) AS c FROM reservations
      WHERE desired_date = ? AND time_slot = 'all_day'
        AND reservation_status IN ${ACTIVE_STATUSES}`,
    [date]
  );
  if (Number(allDayTaken?.c ?? 0) > 0) {
    throw new SlotConflictError("선택하신 날짜는 종일 작업이 예정되어 있습니다. 다른 날짜를 선택해주세요.");
  }

  // 같은 슬롯의 활성 예약이 capacity 미만일 때만 허용한다
  const capacity = await effectiveCapacity(date, timeSlot);
  const active = await queryRow<{ c: number }>(
    `SELECT COUNT(*) AS c FROM reservations
      WHERE desired_date = ? AND time_slot = ?
        AND reservation_status IN ${ACTIVE_STATUSES}`,
    [date, timeSlot]
  );
  if (Number(active?.c ?? 0) >= capacity) {
    throw new SlotConflictError("선택하신 시간은 이미 예약이 마감되었습니다. 다른 시간을 선택해주세요.");
  }
}

/** 쿠폰 한도 소진 오류 */
export class CouponExhaustedError extends Error {
  code = "COUPON_EXHAUSTED";
  constructor(message = "쿠폰 사용 한도가 모두 소진되었습니다. 새로 견적을 받아주세요.") {
    super(message);
    this.name = "CouponExhaustedError";
  }
}

/**
 * 쿠폰 사용을 원자적으로 확정한다.
 *
 * **반드시 예약 저장과 같은 transaction 안에서 호출해야 한다.**
 * 그래야 "한도 확인 → 예약 저장 → redemption 기록"이 하나의 원자 단위가 된다.
 *
 * 동시성: PostgreSQL에서 쿠폰 row를 FOR UPDATE로 잠근 뒤 사용수를 센다.
 * 서로 다른 quoteId 두 건이 마지막 1개를 동시에 노려도 정확히 하나만 통과한다.
 * (단순 SELECT count → INSERT 경쟁조건을 남기지 않는다)
 *
 * 한도가 이미 찼으면 가격을 몰래 재계산하지 않고 CouponExhaustedError를 던진다.
 */
export async function redeemCouponInTransaction(input: {
  couponId: number;
  reservationId: number;
  customerPhone: string | null;
  discountAmount: number;
}): Promise<void> {
  if (getDatabaseBackend() === "postgres") {
    // 쿠폰 row lock — 같은 쿠폰의 동시 사용을 직렬화한다
    await queryRows("SELECT id FROM coupons WHERE id = ? FOR UPDATE", [input.couponId]);
  }

  const coupon = await queryRow<{ total_usage_limit: number | null; per_phone_limit: number | null }>(
    "SELECT total_usage_limit, per_phone_limit FROM coupons WHERE id = ?",
    [input.couponId]
  );
  if (!coupon) throw new CouponExhaustedError("쿠폰 정보를 찾을 수 없습니다.");

  if (coupon.total_usage_limit != null) {
    const used = await queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = ?",
      [input.couponId]
    );
    if (Number(used?.c ?? 0) >= coupon.total_usage_limit) {
      throw new CouponExhaustedError();
    }
  }
  if (coupon.per_phone_limit != null && input.customerPhone) {
    const used = await queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = ? AND customer_phone = ?",
      [input.couponId, input.customerPhone]
    );
    if (Number(used?.c ?? 0) >= coupon.per_phone_limit) {
      throw new CouponExhaustedError("이미 사용하신 쿠폰입니다.");
    }
  }

  await execute(
    `INSERT INTO coupon_redemptions (coupon_id, reservation_id, customer_phone, discount_amount)
     VALUES (?, ?, ?, ?)`,
    [input.couponId, input.reservationId, input.customerPhone, input.discountAmount]
  );
}

/** 예약의 할인 snapshot을 기록한다 (예약 생성 직후, 같은 transaction) */
export function setReservationDiscountSnapshot(
  reservationId: number,
  snap: {
    originalAmount: number;
    automaticDiscountAmount: number;
    couponDiscountAmount: number;
    finalAmount: number;
    promotionId: number | null;
    promotionName: string | null;
    couponId: number | null;
    couponCode: string | null;
  }
): Promise<void> {
  return execute(
    `UPDATE reservations SET
       original_amount = ?, automatic_discount_amount = ?, coupon_discount_amount = ?,
       final_amount = ?, promotion_id = ?, promotion_name = ?, coupon_id = ?, coupon_code = ?
     WHERE id = ?`,
    [
      snap.originalAmount, snap.automaticDiscountAmount, snap.couponDiscountAmount,
      snap.finalAmount, snap.promotionId, snap.promotionName, snap.couponId, snap.couponCode,
      reservationId,
    ]
  );
}

/** 관리자 수동 할인 결과를 예약 snapshot에 반영한다 */
export function applyAdminDiscountSnapshot(input: {
  reservationId: number;
  adminDiscountAmount: number;
  adminDiscountReason: string;
  finalAmount: number;
  estimatedBalance: number;
}): Promise<void> {
  return execute(
    `UPDATE reservations SET
       admin_discount_amount = ?, admin_discount_reason = ?,
       final_amount = ?, estimated_balance_snapshot = ?, final_confirmed_total = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.adminDiscountAmount, input.adminDiscountReason,
      input.finalAmount, input.estimatedBalance, input.finalAmount,
      input.reservationId,
    ]
  );
}

/** 관리자 할인 변경 이력 (audit) */
export function insertDiscountAdjustment(input: {
  reservationId: number;
  adminId: number | null;
  adminName: string;
  discountType: string;
  discountValue: number;
  calculatedAmount: number;
  reason: string;
  previousFinalAmount: number;
  newFinalAmount: number;
}): Promise<void> {
  return execute(
    `INSERT INTO reservation_discount_adjustments
       (reservation_id, admin_id, admin_name, discount_type, discount_value,
        calculated_amount, reason, previous_final_amount, new_final_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.reservationId, input.adminId, input.adminName, input.discountType,
      input.discountValue, input.calculatedAmount, input.reason,
      input.previousFinalAmount, input.newFinalAmount,
    ]
  );
}

/** 예약별 관리자 할인 이력 */
export function listDiscountAdjustments(reservationId: number) {
  return queryRows<{
    id: number; admin_name: string | null; discount_type: string; discount_value: number;
    calculated_amount: number; reason: string; previous_final_amount: number;
    new_final_amount: number; created_at: string;
  }>(
    `SELECT * FROM reservation_discount_adjustments WHERE reservation_id = ? ORDER BY id DESC`,
    [reservationId]
  );
}
