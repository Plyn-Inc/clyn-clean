import { getSetting } from "@/lib/settings";
import { defaultProvider } from "./solapi-provider";
import { maskPhone } from "./provider";

export interface AdminReservationAlertInput {
  reservationCode: string;
  customerName: string;
  customerPhone: string;
  serviceType: string;
  productLabel: string;
  desiredDate: string;
  timeLabel: string;
  areaLabel: string;
  totalAmount: number;
  depositAmount: number;
}

function parseAdminPhones(raw: string): string[] {
  const phones = raw
    .split(/[\s,;]+/)
    .map((value) => value.replace(/\D/g, ""))
    .filter((value) => /^01\d{8,9}$/.test(value));
  return [...new Set(phones)];
}

function won(value: number): string {
  return `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
}

function buildAdminText(input: AdminReservationAlertInput): string {
  return [
    "[Clyn Clean] 신규 홈페이지 예약",
    `예약번호: ${input.reservationCode}`,
    `고객: ${input.customerName} / ${input.customerPhone}`,
    `서비스: ${input.serviceType}${input.productLabel ? ` / ${input.productLabel}` : ""}`,
    `예약일: ${input.desiredDate} ${input.timeLabel}`.trim(),
    input.areaLabel ? `지역: ${input.areaLabel}` : "",
    `총금액: ${won(input.totalAmount)} / 예약금: ${won(input.depositAmount)}`,
    "관리자 페이지에서 확인해주세요.",
  ].filter(Boolean).join("\n");
}

/**
 * 신규 홈페이지 예약을 관리자들에게 SMS/LMS로 알린다.
 *
 * 예약 저장이 완료된 뒤 호출하며, 발송 실패가 예약 성공을 되돌리지 않는다.
 * 수신 번호는 settings.admin_notification_phones에 쉼표/공백/줄바꿈으로 저장한다.
 */
export async function sendAdminReservationAlerts(
  input: AdminReservationAlertInput
): Promise<{ configured: boolean; recipients: number; accepted: number }> {
  const phones = parseAdminPhones(await getSetting("admin_notification_phones"));
  if (phones.length === 0) {
    console.warn("[admin-notify] 관리자 알림 수신번호가 설정되지 않았습니다.");
    return { configured: false, recipients: 0, accepted: 0 };
  }

  const provider = defaultProvider();
  if (!provider.isConfigured()) {
    console.warn("[admin-notify] SOLAPI가 설정되지 않아 관리자 예약 알림을 발송하지 못했습니다.");
    return { configured: false, recipients: phones.length, accepted: 0 };
  }

  const text = buildAdminText(input);
  const results = await Promise.all(
    phones.map(async (phone) => {
      const result = await provider.sendSms({ to: phone, text });
      if (!result.accepted) {
        console.warn(
          `[admin-notify] send failed to=${maskPhone(phone)} code=${result.errorCode ?? "UNKNOWN"}`
        );
      }
      return result.accepted;
    })
  );

  return {
    configured: true,
    recipients: phones.length,
    accepted: results.filter(Boolean).length,
  };
}
