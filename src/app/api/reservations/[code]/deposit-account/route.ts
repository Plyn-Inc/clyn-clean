import { NextRequest, NextResponse } from "next/server";
import { DatabaseTimeoutError, isConnectionError } from "@/database/connection";
import {
  getReservationByCode,
  revealDepositAccount,
  DepositAccountError,
  DEPOSIT_DEADLINE_HOURS,
} from "@/lib/reservations";
import { getBankSettings } from "@/lib/settings";
import { findPaymentByReservationId } from "@/database/repositories/reservation-repository";
import { normalizePhone, formatWorkArea } from "@/lib/utils";
import { VAT_NOTICE } from "@/lib/types";

/**
 * 예약금 입금 계좌 확인 (요구사항 14~16)
 *
 * 계좌정보는 이 엔드포인트에서만 반환된다.
 * 초기 HTML / 예약 생성 응답 / 캘린더 payload 어디에도 계좌번호가 포함되지 않는다.
 *
 * 서버가 다음을 모두 재검증한 뒤에만 계좌를 반환한다:
 *   필수 고객정보(이름 · 연락처 · 작업지역)
 *   + 개인정보 수집·이용 동의
 *   + 서비스 3종 동의 (핵심원칙 / 1~11 전체 / 추가요금 인지)
 *   + 슬롯 가용성
 *
 * 본인 확인을 위해 예약번호 + 연락처를 함께 요구한다.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> }
) {
  const { code } = await ctx.params;
  const body = await req.json().catch(() => null);
  const phone = String(body?.phone ?? "");

  if (!code || !phone) {
    return NextResponse.json(
      { error: "예약번호와 연락처가 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const reservation = await getReservationByCode(code);
    if (!reservation) {
      return NextResponse.json({ error: "예약을 찾을 수 없습니다." }, { status: 404 });
    }

    // 본인 확인 — 예약번호만으로 계좌가 노출되지 않도록 연락처를 대조한다
    if (normalizePhone(reservation.customer_phone) !== normalizePhone(phone)) {
      return NextResponse.json({ error: "예약 정보가 일치하지 않습니다." }, { status: 403 });
    }

    // 아직 계좌가 안내되지 않았다면 여기서 전체 검증 + payment 생성이 이뤄진다.
    if (!reservation.account_revealed_at) {
      await revealDepositAccount(reservation.id);
    }

    const updated = await getReservationByCode(code);
    const payment = updated ? await findPaymentByReservationId(updated.id) : undefined;
    if (!updated || !payment) {
      return NextResponse.json(
        { error: "예약금 정보를 찾을 수 없습니다.", code: "DEPOSIT_INFO_NOT_FOUND" },
        { status: 500 }
      );
    }

    const bank = await getBankSettings();

    return NextResponse.json({
      reservationCode: updated.reservation_code,
      customerName: updated.customer_name,
      workArea: formatWorkArea({
        sido: updated.area_sido ?? "",
        sigungu: updated.area_sigungu ?? "",
        dong: updated.area_dong ?? "",
      }),
      desiredDate: updated.desired_date,
      timeSlot: updated.time_slot,
      moveOutTime: updated.move_out_time,
      moveInTime: updated.move_in_time,
      totalAmount: updated.final_confirmed_total,
      depositAmount: updated.deposit_amount_snapshot,
      balanceAmount: updated.estimated_balance_snapshot,
      vatNotice: VAT_NOTICE,
      account: {
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        accountHolder: bank.accountHolder,
      },
      depositDeadline: payment.payment_due_date,
      depositDeadlineHours: DEPOSIT_DEADLINE_HOURS,
      accountRevealedAt: updated.account_revealed_at,
    });
  } catch (e) {
    if (e instanceof DepositAccountError) {
      const status =
        e.code === "SLOT_TAKEN" || e.code === "SLOT_UNAVAILABLE" ? 409 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    if (e instanceof DatabaseTimeoutError) {
      return NextResponse.json(
        { error: "예약금 안내 서버 응답이 지연되고 있습니다. 다시 시도해주세요.", code: "DB_TIMEOUT" },
        { status: 503 }
      );
    }
    if (isConnectionError(e)) {
      return NextResponse.json(
        { error: "예약금 안내 서버에 연결하지 못했습니다. 다시 시도해주세요.", code: "DB_UNAVAILABLE" },
        { status: 503 }
      );
    }
    console.error("[deposit-account] failed", e);
    return NextResponse.json(
      { error: "예약금 계좌 안내 중 오류가 발생했습니다.", code: "DEPOSIT_ACCOUNT_FAILED" },
      { status: 500 }
    );
  }
}
