/**
 * 이벤트별 메시지 내용.
 *
 * 상세주소 등 불필요한 개인정보는 넣지 않는다.
 * payload는 이벤트 생성 시점의 snapshot이며, 이후 예약/계좌 설정이 바뀌어도
 * 이미 만들어진 메시지 내용은 변하지 않는다.
 */

export type NotificationEvent =
  | "reservation_received"
  | "deposit_confirmed"
  | "reservation_confirmed";

export interface ReservationReceivedPayload {
  customerName: string;
  reservationCode: string;
  serviceType: string;
  desiredDate: string;
  timeLabel: string;
  depositAmount: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}
export interface DepositConfirmedPayload {
  customerName: string;
  reservationCode: string;
}
export interface ReservationConfirmedPayload {
  customerName: string;
  reservationCode: string;
  serviceType: string;
  desiredDate: string;
  timeLabel: string;
}

const won = (n: number) => `${Number(n || 0).toLocaleString("ko-KR")}원`;

/** 알림톡 템플릿 변수 + 문자 대체 본문을 함께 만든다 */
export function buildMessage(
  event: NotificationEvent,
  payload: Record<string, unknown>
): { variables: Record<string, string>; text: string } {
  if (event === "reservation_received") {
    const p = payload as unknown as ReservationReceivedPayload;
    const variables = {
      "#{고객명}": p.customerName ?? "",
      "#{예약번호}": p.reservationCode ?? "",
      "#{서비스}": p.serviceType ?? "",
      "#{청소일}": p.desiredDate ?? "",
      "#{시간}": p.timeLabel ?? "",
      "#{예약금}": won(p.depositAmount),
      "#{은행}": p.bankName ?? "",
      "#{계좌번호}": p.accountNumber ?? "",
      "#{예금주}": p.accountHolder ?? "",
    };
    const text = [
      `[Clyn Clean] 예약이 접수되었습니다.`,
      `${p.customerName}님 / 예약번호 ${p.reservationCode}`,
      `${p.serviceType} · ${p.desiredDate} ${p.timeLabel}`,
      `예약금 ${won(p.depositAmount)}`,
      `${p.bankName} ${p.accountNumber} (${p.accountHolder})`,
      `입금 확인 후 관리자가 예약을 확정합니다.`,
    ].join("\n");
    return { variables, text };
  }

  if (event === "deposit_confirmed") {
    const p = payload as unknown as DepositConfirmedPayload;
    return {
      variables: {
        "#{고객명}": p.customerName ?? "",
        "#{예약번호}": p.reservationCode ?? "",
      },
      text: [
        `[Clyn Clean] 예약금 입금이 확인되었습니다.`,
        `${p.customerName}님 / 예약번호 ${p.reservationCode}`,
        `관리자 최종 확인 후 예약이 확정됩니다.`,
      ].join("\n"),
    };
  }

  const p = payload as unknown as ReservationConfirmedPayload;
  return {
    variables: {
      "#{고객명}": p.customerName ?? "",
      "#{예약번호}": p.reservationCode ?? "",
      "#{서비스}": p.serviceType ?? "",
      "#{청소일}": p.desiredDate ?? "",
      "#{시간}": p.timeLabel ?? "",
    },
    text: [
      `[Clyn Clean] 예약이 확정되었습니다.`,
      `${p.customerName}님 / 예약번호 ${p.reservationCode}`,
      `${p.serviceType} · ${p.desiredDate} ${p.timeLabel}`,
      `작업일에 정확히 방문드리겠습니다.`,
    ].join("\n"),
  };
}

export function timeSlotLabel(slot: string | null): string {
  if (slot === "morning") return "오전";
  if (slot === "afternoon") return "오후";
  if (slot === "all_day") return "종일";
  return "";
}
