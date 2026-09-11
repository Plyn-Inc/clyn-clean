import { execute, insertReturningId, queryRow, queryRows } from "../connection";
import type { ConsultationRequest, ConsultationStatus } from "@/lib/types";

export interface CreateConsultationRow {
  requestCode: string;
  customerName: string;
  customerPhone: string;
  areaSido: string | null;
  areaSigungu: string | null;
  areaDong: string | null;
  address: string | null;
  serviceType: string | null;
  houseTypeKey: string | null;
  actualPyeong: number | null;
  preferredDate: string | null;
  preferredTimeSlot: string | null;
  reason: string;
  petMeta: string | null;
  extraNotes: string | null;
  referencePrice: number | null;
  privacyAgreed: number;
}

export function insertConsultation(row: CreateConsultationRow): Promise<number> {
  return insertReturningId(
    `INSERT INTO consultation_requests (
      request_code, customer_name, customer_phone,
      area_sido, area_sigungu, area_dong, address,
      service_type, house_type_key, actual_pyeong,
      preferred_date, preferred_time_slot,
      reason, pet_meta, extra_notes, reference_price,
      privacy_agreed, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')`,
    [
      row.requestCode, row.customerName, row.customerPhone,
      row.areaSido, row.areaSigungu, row.areaDong, row.address,
      row.serviceType, row.houseTypeKey, row.actualPyeong,
      row.preferredDate, row.preferredTimeSlot,
      row.reason, row.petMeta, row.extraNotes, row.referencePrice,
      row.privacyAgreed,
    ]
  );
}

export function findConsultationById(id: number): Promise<ConsultationRequest | undefined> {
  return queryRow<ConsultationRequest>("SELECT * FROM consultation_requests WHERE id = ?", [id]);
}

export function findConsultationByCode(code: string): Promise<ConsultationRequest | undefined> {
  return queryRow<ConsultationRequest>(
    "SELECT * FROM consultation_requests WHERE request_code = ?",
    [code]
  );
}

export function listConsultations(filter?: { status?: ConsultationStatus }): Promise<ConsultationRequest[]> {
  if (filter?.status) {
    return queryRows<ConsultationRequest>(
      "SELECT * FROM consultation_requests WHERE status = ? ORDER BY created_at DESC",
      [filter.status]
    );
  }
  return queryRows<ConsultationRequest>(
    "SELECT * FROM consultation_requests ORDER BY created_at DESC"
  );
}

export function setConsultationStatus(id: number, status: ConsultationStatus): Promise<void> {
  return execute(
    `UPDATE consultation_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, id]
  );
}

export function setConsultationMemo(id: number, memo: string): Promise<void> {
  return execute(
    `UPDATE consultation_requests SET admin_memo = ?, updated_at = datetime('now') WHERE id = ?`,
    [memo, id]
  );
}

export function linkConvertedReservation(id: number, reservationId: number): Promise<void> {
  return execute(
    `UPDATE consultation_requests
        SET converted_reservation_id = ?, status = 'converted', updated_at = datetime('now')
      WHERE id = ?`,
    [reservationId, id]
  );
}
