/**
 * 테스트/개발용 provider.
 *
 * 외부 네트워크에 의존하지 않는다. 시나리오를 주입해
 * 카카오 실패 → 문자 fallback, timeout, 영구 실패를 재현한다.
 */
import type {
  NotificationProvider, KakaoSendInput, SmsSendInput, SendResult, DeliveryStatus,
} from "./provider";

export interface MockScenario {
  kakao?: SendResult | (() => Promise<SendResult>);
  sms?: SendResult | (() => Promise<SendResult>);
  delivery?: DeliveryStatus | (() => Promise<DeliveryStatus>);
  configured?: boolean;
}

export class MockNotificationProvider implements NotificationProvider {
  readonly name = "mock";
  /** 발송 시도 기록 — 테스트에서 확인한다 */
  readonly calls: { channel: string; to: string }[] = [];

  constructor(private scenario: MockScenario = {}) {}

  isConfigured(): boolean {
    return this.scenario.configured !== false;
  }

  private async resolve(
    v: SendResult | (() => Promise<SendResult>) | undefined,
    fallback: SendResult
  ): Promise<SendResult> {
    if (typeof v === "function") return v();
    return v ?? fallback;
  }

  async sendKakao(input: KakaoSendInput): Promise<SendResult> {
    this.calls.push({ channel: "kakao", to: input.to });
    return this.resolve(this.scenario.kakao, {
      accepted: true,
      providerMessageId: `mock-kakao-${this.calls.length}`,
      providerStatus: "ACCEPTED",
    });
  }

  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatus> {
    this.calls.push({ channel: "lookup", to: providerMessageId });
    const v = this.scenario.delivery;
    if (typeof v === "function") return v();
    return v ?? { outcome: "delivered", providerStatus: "4000" };
  }

  async sendSms(input: SmsSendInput): Promise<SendResult> {
    this.calls.push({ channel: "sms", to: input.to });
    return this.resolve(this.scenario.sms, {
      accepted: true,
      providerMessageId: `mock-sms-${this.calls.length}`,
      providerStatus: "ACCEPTED",
    });
  }
}
