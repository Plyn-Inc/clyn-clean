import { execute, executeReturningCount, insertReturningId, queryRow, queryRows } from "../connection";
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
      reservation_status
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
      ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
      ?, ?, ?,
      ?, ?, ?,
      ?, CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END,
      'received'
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
    ]
  );
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

export async function countByStatus(status: ReservationStatus): Promise<number> {
  const row = await queryRow<{ c: number | string }>("SELECT COUNT(*) as c FROM reservations WHERE reservation_status = ?", [status]);
  return Number(row?.c ?? 0);
}

export async function countAll(): Promise<number> {
  const row = await queryRow<{ c: number | string }>("SELECT COUNT(*) as c FROM reservations");
  return Number(row?.c ?? 0);
}
