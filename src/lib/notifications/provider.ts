/**
 * 알림 provider 인터페이스.
 *
 * business 코드는 SOLAPI SDK를 직접 호출하지 않는다.
 * 이 인터페이스만 사용하고, 구현체(Solapi / Mock)를 주입받는다.
 */

export type NotificationChannel = "kakao" | "sms" | "lms";

export interface SendResult {
  /** provider가 요청을 접수했는지. 실제 수신 확인(delivered)과 다르다. */
  accepted: boolean;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /**
   * 재시도해도 의미가 없는 영구 실패인지.
   * (잘못된 번호, 템플릿 오류, credential 오류 등)
   */
  permanent?: boolean;
}

export interface KakaoSendInput {
  to: string;
  templateKey: string;
  variables: Record<string, string>;
  /** 알림톡 실패 시 provider 자체 문자 대체를 쓰지 않는다 (우리가 직접 fallback 처리) */
  fallbackText?: string;
}

export interface SmsSendInput {
  to: string;
  text: string;
}

export interface NotificationProvider {
  readonly name: string;
  /** 설정이 완료되어 실제 발송이 가능한지 */
  isConfigured(): boolean;
  sendKakao(input: KakaoSendInput): Promise<SendResult>;
  sendSms(input: SmsSendInput): Promise<SendResult>;
  /**
   * 발송 결과를 조회한다.
   *
   * provider가 아직 결과를 모르면 "pending", 조회 자체가 실패하면 "unknown"을 반환한다.
   * "unknown"일 때 문자로 대체하면 중복 발송이 되므로 호출부가 구분해야 한다.
   */
  getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatus>;
}

/**
 * SMS 바이트 한도.
 *
 * 국내 SMS 규격은 EUC-KR 기준 90바이트다 (한글 2byte / ASCII 1byte).
 * JS string.length는 한글/영문 혼합에서 틀리므로 쓰지 않는다.
 *
 * 실제 전송 타입은 SOLAPI의 autoTypeDetect가 최종 결정하며,
 * 이 함수는 기록·표시용 채널 판정에만 쓴다.
 */
export const SMS_BYTE_LIMIT = 90;

/** EUC-KR 기준 바이트 수 — BMP 밖 문자(이모지 등)도 2byte 이상으로 센다 */
export function textByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp > 0x7f ? 2 : 1;
  }
  return bytes;
}

/** 바이트 수로 SMS/LMS를 판정한다 (표시·기록용) */
export function resolveTextChannel(text: string): "sms" | "lms" {
  return textByteLength(text) > SMS_BYTE_LIMIT ? "lms" : "sms";
}

/** 알림톡 전달 결과 조회 결과 */
export type DeliveryOutcome = "delivered" | "failed" | "pending" | "unknown";

export interface DeliveryStatus {
  outcome: DeliveryOutcome;
  /** provider 상태 코드 (SOLAPI statusCode) */
  providerStatus?: string | null;
  /** 실패 사유 (SOLAPI reason) */
  reason?: string | null;
  /** 실제 전송 타입 (ATA/SMS/LMS 등) */
  messageType?: string | null;
}

/** 로그용 전화번호 마스킹 — 전체 번호를 로그에 남기지 않는다 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}
