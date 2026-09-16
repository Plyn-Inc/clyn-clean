/**
 * SOLAPI 알림 provider.
 *
 * 공식 SDK `solapi@6` 의 SolapiMessageService.send()를 사용한다.
 * (추정이 아니라 설치된 SDK의 타입 정의로 확인한 규격이다)
 *
 * 알림톡 옵션 규격: kakaoOptions = { pfId, templateId, variables, disableSms }
 *   - disableSms: true — provider 자체 문자 대체를 끄고 우리가 직접 fallback을 제어한다.
 *     그래야 실제 채널과 실패 사유를 Admin에서 추적할 수 있다.
 *
 * secret은 서버 환경변수로만 읽는다 (NEXT_PUBLIC_ 금지).
 */
import type {
  NotificationProvider, KakaoSendInput, SmsSendInput, SendResult, DeliveryStatus,
} from "./provider";

interface DeliveryRecord {
  statusCode?: string | null;
  reason?: string | null;
  type?: string | null;
  dateReceived?: string | null;
}

export class SolapiConfigError extends Error {
  code = "NOTIFICATION_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "SolapiConfigError";
  }
}

interface SolapiEnv {
  apiKey: string;
  apiSecret: string;
  senderNumber: string;
  pfId: string;
}

function readEnv(): SolapiEnv | null {
  const apiKey = process.env.SOLAPI_API_KEY?.trim();
  const apiSecret = process.env.SOLAPI_API_SECRET?.trim();
  const senderNumber = process.env.SOLAPI_SENDER_NUMBER?.trim();
  const pfId = process.env.SOLAPI_KAKAO_PF_ID?.trim();
  if (!apiKey || !apiSecret || !senderNumber) return null;
  return { apiKey, apiSecret, senderNumber, pfId: pfId ?? "" };
}

/** 이벤트별 알림톡 템플릿 ID */
export function templateIdFor(eventType: string): string | null {
  const map: Record<string, string | undefined> = {
    reservation_received: process.env.SOLAPI_TEMPLATE_RESERVATION_RECEIVED,
    deposit_confirmed: process.env.SOLAPI_TEMPLATE_DEPOSIT_CONFIRMED,
    reservation_confirmed: process.env.SOLAPI_TEMPLATE_RESERVATION_CONFIRMED,
  };
  return map[eventType]?.trim() || null;
}

/**
 * SOLAPI 오류를 재시도 가능/영구 실패로 분류한다.
 *
 * 재시도: timeout, 네트워크, 5xx
 * 영구 실패: 잘못된 번호, 템플릿 오류, credential 오류, 검증 오류
 */
function classifyError(e: unknown): { code: string; message: string; permanent: boolean } {
  const err = e as { name?: string; message?: string; errorCode?: string; status?: number };
  const name = String(err?.name ?? "");
  const code = String(err?.errorCode ?? err?.name ?? "UNKNOWN");
  const message = String(err?.message ?? "발송 실패");

  // SDK가 제공하는 오류 클래스명 기준 (solapi@6)
  if (name === "NetworkError" || name === "UnhandledExitError") {
    return { code, message, permanent: false };
  }
  if (name === "ServerError") return { code, message, permanent: false };
  if (name === "ApiKeyError") return { code, message, permanent: true };
  if (name === "BadRequestError" || name === "ClientError") {
    return { code, message, permanent: true };
  }
  if (name === "VariableValidationError" || name === "ResponseSchemaMismatchError") {
    return { code, message, permanent: true };
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(message)) {
    return { code, message, permanent: false };
  }
  if (typeof err?.status === "number") {
    return { code, message, permanent: err.status < 500 };
  }
  // 분류 불가 — 보수적으로 재시도 대상
  return { code, message, permanent: false };
}

export class SolapiNotificationProvider implements NotificationProvider {
  readonly name = "solapi";

  isConfigured(): boolean {
    return readEnv() !== null;
  }

  private async service() {
    const env = readEnv();
    if (!env) {
      throw new SolapiConfigError(
        "메시지 발송이 설정되지 않았습니다. SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER_NUMBER를 등록해주세요."
      );
    }
    const { SolapiMessageService } = await import("solapi");
    return { svc: new SolapiMessageService(env.apiKey, env.apiSecret), env };
  }

  async sendKakao(input: KakaoSendInput): Promise<SendResult> {
    let env: SolapiEnv;
    try {
      const s = await this.service();
      env = s.env;
      if (!env.pfId) {
        return {
          accepted: false,
          errorCode: "NO_PF_ID",
          errorMessage: "카카오 채널(PF ID)이 설정되지 않았습니다.",
          permanent: true,
        };
      }
      const res = await s.svc.send({
        to: input.to,
        from: env.senderNumber,
        // 알림톡 심사 템플릿 본문이 사용되므로 text는 대체 문구로만 쓰인다
        text: input.fallbackText ?? "",
        kakaoOptions: {
          pfId: env.pfId,
          templateId: input.templateKey,
          variables: input.variables,
          // provider 자체 문자 대체를 끄고 우리가 직접 fallback을 제어한다
          disableSms: true,
        },
      });
      const r = res as unknown as { groupId?: string; messageId?: string; statusCode?: string };
      return {
        accepted: true,
        providerMessageId: r.messageId ?? r.groupId ?? null,
        providerStatus: r.statusCode ?? "ACCEPTED",
      };
    } catch (e) {
      if (e instanceof SolapiConfigError) {
        return { accepted: false, errorCode: e.code, errorMessage: e.message, permanent: true };
      }
      const c = classifyError(e);
      return { accepted: false, errorCode: c.code, errorMessage: c.message, permanent: c.permanent };
    }
  }

  /**
   * 발송 결과를 조회한다 (공식 SDK getMessages).
   *
   * 규격(solapi@6 타입 정의 기준):
   *   getMessages({ messageId }) → { messageList | messages } 각 항목에
   *   statusCode / reason / type / dateReceived
   *
   * SOLAPI statusCode 규약: "4000"이 성공, 그 외는 실패 또는 진행 중.
   * 조회 자체가 실패하면 "unknown"을 반환한다 — 호출부가 문자 중복 발송을 피해야 한다.
   */
  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatus> {
    try {
      const { svc } = await this.service();
      const res = await svc.getMessages({ messageId: providerMessageId });
      const r = res as unknown as {
        messageList?: Record<string, DeliveryRecord>;
        messages?: DeliveryRecord[];
      };
      const record =
        (r.messageList ? Object.values(r.messageList)[0] : undefined) ??
        r.messages?.[0];

      if (!record) return { outcome: "unknown" };

      const statusCode = record.statusCode ?? null;
      const messageType = record.type ?? null;

      // 성공: statusCode 4000 또는 수신 시각이 기록됨
      if (statusCode === "4000" || record.dateReceived) {
        return { outcome: "delivered", providerStatus: statusCode, messageType };
      }
      // 아직 진행 중인 상태 (2000번대 = 접수/전송 중)
      if (statusCode && /^2\d{3}$/.test(statusCode)) {
        return { outcome: "pending", providerStatus: statusCode, messageType };
      }
      if (statusCode) {
        return {
          outcome: "failed",
          providerStatus: statusCode,
          reason: record.reason ?? null,
          messageType,
        };
      }
      return { outcome: "pending", providerStatus: statusCode, messageType };
    } catch (e) {
      if (e instanceof SolapiConfigError) return { outcome: "unknown", reason: e.code };
      const c = classifyError(e);
      // 조회 실패는 전달 실패가 아니다. 문자로 대체하지 않는다.
      return { outcome: "unknown", reason: c.code };
    }
  }

  async sendSms(input: SmsSendInput): Promise<SendResult> {
    try {
      const { svc, env } = await this.service();
      // SMS/LMS 타입은 SOLAPI가 본문 길이로 자동 판별하게 한다.
      // 임의 기준으로 타입을 강제하면 한글/영문 혼합에서 틀릴 수 있다.
      const res = await svc.send({
        to: input.to,
        from: env.senderNumber,
        text: input.text,
        autoTypeDetect: true,
      });
      const r = res as unknown as { groupId?: string; messageId?: string; statusCode?: string };
      return {
        accepted: true,
        providerMessageId: r.messageId ?? r.groupId ?? null,
        providerStatus: r.statusCode ?? "ACCEPTED",
      };
    } catch (e) {
      if (e instanceof SolapiConfigError) {
        return { accepted: false, errorCode: e.code, errorMessage: e.message, permanent: true };
      }
      const c = classifyError(e);
      return { accepted: false, errorCode: c.code, errorMessage: c.message, permanent: c.permanent };
    }
  }
}

/** 기본 provider — 설정이 없으면 미설정 상태로 동작한다 (build를 막지 않는다) */
export function defaultProvider(): NotificationProvider {
  return new SolapiNotificationProvider();
}
