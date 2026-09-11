import * as repo from "@/database/repositories/consultation-repository";
import { calculateQuote } from "./pricing";
import { normalizePhone } from "./utils";
import type { ConsultationRequest, ConsultationStatus } from "./types";

/**
 * 상담접수 생성.
 *
 * 일반 예약(reservations)과 완전히 분리된 파이프라인이다.
 * 상담접수는 calendar 슬롯을 점유하지 않으며 payment를 만들지 않는다.
 */
export interface CreateConsultationInput {
  customerName: string;
  customerPhone: string;
  areaSido?: string;
  areaSigungu?: string;
  areaDong?: string;
  address?: string;
  serviceType?: string;
  houseTypeKey?: string;
  actualPyeong?: number;
  preferredDate?: string;
  preferredTimeSlot?: string;
  reason?: string;
  petMeta?: Record<string, unknown> | null;
  extraNotes?: string;
  privacyAgreed?: boolean;
}

function generateRequestCode(): string {
  const now = new Date();
  const ymd =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CS-${ymd}-${rand}`;
}

export async function createConsultation(
  input: CreateConsultationInput
): Promise<ConsultationRequest> {
  // 상담 참고용 시작가 — 확정 견적이 아니다.
  let referencePrice: number | null = null;
  if (input.serviceType && input.houseTypeKey) {
    try {
      const q = await calculateQuote({
        serviceType: input.serviceType,
        houseTypeKey: input.houseTypeKey,
        actualPyeong: input.actualPyeong,
      });
      referencePrice = q.basePrice > 0 ? q.basePrice : null;
    } catch {
      referencePrice = null;
    }
  }

  const code = generateRequestCode();
  const id = await repo.insertConsultation({
    requestCode: code,
    customerName: input.customerName.trim(),
    customerPhone: normalizePhone(input.customerPhone),
    areaSido: input.areaSido?.trim() || null,
    areaSigungu: input.areaSigungu?.trim() || null,
    areaDong: input.areaDong?.trim() || null,
    address: input.address?.trim() || null,
    serviceType: input.serviceType ?? null,
    houseTypeKey: input.houseTypeKey ?? null,
    actualPyeong: input.actualPyeong ?? null,
    preferredDate: input.preferredDate ?? null,
    preferredTimeSlot: input.preferredTimeSlot ?? null,
    reason: input.reason ?? "manual",
    petMeta: input.petMeta ? JSON.stringify(input.petMeta) : null,
    extraNotes: input.extraNotes ?? null,
    referencePrice,
    privacyAgreed: input.privacyAgreed ? 1 : 0,
  });

  const created = await repo.findConsultationById(id);
  if (!created) throw new Error("상담 접수 생성 결과를 찾을 수 없습니다.");
  return created;
}

export function getConsultationById(id: number) {
  return repo.findConsultationById(id);
}
export function getConsultationByCode(code: string) {
  return repo.findConsultationByCode(code);
}
export function listConsultations(filter?: { status?: ConsultationStatus }) {
  return repo.listConsultations(filter);
}
export function updateConsultationStatus(id: number, status: ConsultationStatus) {
  return repo.setConsultationStatus(id, status);
}
export function updateConsultationMemo(id: number, memo: string) {
  return repo.setConsultationMemo(id, memo);
}
export function linkConvertedReservation(id: number, reservationId: number) {
  return repo.linkConvertedReservation(id, reservationId);
}
