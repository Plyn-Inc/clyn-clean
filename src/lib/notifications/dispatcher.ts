/**
 * outbox 발송 processor.
 *
 * **business transaction 밖에서만 실행한다.** provider 장애가 이미 완료된
 * 예약/입금확인/예약확정을 rollback시키지 않는다.
 *
 * 상태 흐름:
 *   pending → processing → submitted            (알림톡 접수 성공)
 *   processing → kakao_failed → fallback_submitted  (문자 대체 성공)
 *   processing → retry_pending → processing     (일시 실패)
 *   processing → failed                         (영구 실패 또는 최대 시도 초과)
 *
 * submitted는 "provider가 요청을 접수함"이다. 실제 수신(delivered)과 구분한다.
 */
import { withTransaction } from "@/database/connection";
import * as outbox from "@/database/repositories/outbox-repository";
import { buildMessage, type NotificationEvent } from "./messages";
import { maskPhone, resolveTextChannel, type NotificationProvider } from "./provider";
import { templateIdFor } from "./solapi-provider";

/** 최대 시도 횟수 — 무한 재시도를 막는다 */
export const MAX_ATTEMPTS = 5;

/** 재시도 간격 (분) */
function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

function nextAttemptAt(attempts: number): string {
  return new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
}

export interface DispatchSummary {
  processed: number;
  submitted: number;
  fallback: number;
  retried: number;
  failed: number;
}

/**
 * 대기 중인 outbox를 최대 limit건 처리한다.
 *
 * 각 건마다 claim(트랜잭션)과 발송(트랜잭션 밖)을 분리한다.
 * scheduler가 중복 호출돼도 claim의 SKIP LOCKED/직렬화로 같은 row를 두 번 보내지 않는다.
 */
export async function dispatchPending(
  provider: NotificationProvider,
  limit = 10
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { processed: 0, submitted: 0, fallback: 0, retried: 0, failed: 0 };

  for (let i = 0; i < limit; i++) {
    // 1) 잠금은 짧은 transaction 안에서
    const row = await withTransaction(() => outbox.claimNext(new Date().toISOString()));
    if (!row) break;
    summary.processed++;

    // 2) 외부 호출은 transaction 밖에서
    const result = await deliverOne(provider, row);
    if (result === "submitted") summary.submitted++;
    else if (result === "fallback") summary.fallback++;
    else if (result === "retry") summary.retried++;
    else summary.failed++;
  }
  return summary;
}

type DeliverOutcome = "submitted" | "fallback" | "retry" | "failed";

async function deliverOne(
  provider: NotificationProvider,
  row: outbox.OutboxRow
): Promise<DeliverOutcome> {
  const payload = JSON.parse(row.payload_snapshot ?? "{}") as Record<string, unknown>;
  const to = String(payload.customerPhone ?? "");
  const { variables, text } = buildMessage(row.event_type as NotificationEvent, payload);

  if (!provider.isConfigured()) {
    await outbox.markResult(row.id, {
      status: "retry_pending",
      next_attempt_at: nextAttemptAt(row.attempts),
      last_error_code: "NOTIFICATION_NOT_CONFIGURED",
      last_error_message: "메시지 발송이 설정되지 않았습니다.",
      provider: provider.name,
    });
    return "retry";
  }
  if (!to) {
    await outbox.markResult(row.id, {
      status: "failed", failed_at: new Date().toISOString(),
      last_error_code: "NO_RECIPIENT", last_error_message: "수신 번호가 없습니다.",
      provider: provider.name,
    });
    return "failed";
  }

  // 1차: 카카오 알림톡
  const templateId = row.template_key ?? templateIdFor(row.event_type);
  let kakaoErr: { code: string; message: string; permanent: boolean } | null = null;

  if (templateId) {
    const r = await provider.sendKakao({ to, templateKey: templateId, variables, fallbackText: text });
    if (r.accepted) {
      // provider가 요청을 접수했을 뿐이다. 실제 전달 결과는 reconcile에서 확인한다.
      await outbox.markResult(row.id, {
        status: "awaiting_delivery", actual_channel: "kakao",
        submitted_at: new Date().toISOString(),
        provider: provider.name,
        provider_message_id: r.providerMessageId ?? null,
        kakao_message_id: r.providerMessageId ?? null,
        provider_status: r.providerStatus ?? null,
        next_reconcile_at: new Date(Date.now() + 60_000).toISOString(),
      });
      return "submitted";
    }
    kakaoErr = {
      code: r.errorCode ?? "KAKAO_FAILED",
      message: r.errorMessage ?? "알림톡 발송 실패",
      permanent: r.permanent === true,
    };
  } else {
    kakaoErr = { code: "NO_TEMPLATE", message: "알림톡 템플릿이 설정되지 않았습니다.", permanent: true };
  }

  // 2차: SMS/LMS fallback
  //
  // tryBeginFallback()은 fallback_started_at이 비어 있을 때만 성공한다.
  // 성공한 실행만 실제로 문자를 보낸다 — 동시 실행뿐 아니라 수동 requeue나
  // 순차 재진입으로도 같은 row에서 문자가 두 번 나가지 않는다.
  const beganFallback = await outbox.tryBeginFallback(row.id, new Date().toISOString());
  if (!beganFallback) {
    // 이 row는 이미 문자 대체가 시작됐다. 문자를 다시 보내지 않는다.
    //
    // 상태를 processing에 방치하면 어떤 processor도 집지 못하고 멈추므로,
    // 이미 문자를 제출했으면 결과 확인(reconcile)에 넘기고,
    // 아직 제출 전이면 재시도 대기로 되돌린다.
    console.warn(
      `[notify] fallback already started event=${row.event_type} id=${row.id} — 재발송하지 않음`
    );
    const alreadySubmitted = !!row.fallback_message_id;
    if (alreadySubmitted) {
      await outbox.markResult(row.id, {
        status: "fallback_submitted",
        next_reconcile_at: new Date(Date.now() + 60_000).toISOString(),
        provider: provider.name,
      });
      return "fallback";
    }
    // 문자 제출 전이라면 최대 시도 횟수를 존중해 종료 여부를 판단한다
    if (row.attempts >= MAX_ATTEMPTS) {
      await outbox.markResult(row.id, {
        status: "failed", failed_at: new Date().toISOString(),
        last_error_code: kakaoErr.code,
        last_error_message: kakaoErr.message,
        provider: provider.name,
      });
      return "failed";
    }
    await outbox.markResult(row.id, {
      status: "retry_pending",
      next_attempt_at: nextAttemptAt(row.attempts),
      last_error_code: kakaoErr.code,
      last_error_message: kakaoErr.message,
      provider: provider.name,
    });
    return "retry";
  }

  await outbox.markResult(row.id, {
    status: "kakao_failed",
    last_error_code: kakaoErr.code,
    last_error_message: kakaoErr.message,
    provider: provider.name,
  });
  console.warn(
    `[notify] kakao failed event=${row.event_type} to=${maskPhone(to)} code=${kakaoErr.code}`
  );

  const channel = resolveTextChannel(text);
  const sms = await provider.sendSms({ to, text });
  if (sms.accepted) {
    await outbox.markResult(row.id, {
      status: "fallback_submitted", actual_channel: channel,
      submitted_at: new Date().toISOString(),
      provider: provider.name,
      provider_message_id: sms.providerMessageId ?? null,
      fallback_message_id: sms.providerMessageId ?? null,
      next_reconcile_at: new Date(Date.now() + 60_000).toISOString(),
      provider_status: sms.providerStatus ?? null,
    });
    return "fallback";
  }

  // 둘 다 실패
  const permanent = (sms.permanent === true && kakaoErr.permanent) || row.attempts >= MAX_ATTEMPTS;
  if (permanent) {
    await outbox.markResult(row.id, {
      status: "failed", failed_at: new Date().toISOString(),
      last_error_code: sms.errorCode ?? kakaoErr.code,
      last_error_message: sms.errorMessage ?? kakaoErr.message,
      provider: provider.name,
    });
    return "failed";
  }
  await outbox.markResult(row.id, {
    status: "retry_pending",
    next_attempt_at: nextAttemptAt(row.attempts),
    last_error_code: sms.errorCode ?? kakaoErr.code,
    last_error_message: sms.errorMessage ?? kakaoErr.message,
    provider: provider.name,
  });
  return "retry";
}

/** 결과 조회 최대 재시도 — 무한 polling 방지 */
export const MAX_RECONCILE_ATTEMPTS = 20;

export interface ReconcileSummary {
  checked: number;
  delivered: number;
  fellBack: number;
  stillPending: number;
  failed: number;
}

/**
 * 전달 결과를 확인해 상태를 확정한다.
 *
 * awaiting_delivery  → delivered | kakao_failed(→문자 대체) | 계속 대기
 * fallback_submitted → fallback_delivered | failed | 계속 대기
 *
 * 중요: 조회 자체가 실패("unknown")했다고 문자를 보내지 않는다.
 *       provider 장애를 전달 실패로 오인하면 중복 발송이 된다.
 */
export async function reconcileDeliveries(
  provider: NotificationProvider,
  limit = 20
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    checked: 0, delivered: 0, fellBack: 0, stillPending: 0, failed: 0,
  };

  for (let i = 0; i < limit; i++) {
    const row = await withTransaction(() => outbox.claimForReconcile(new Date().toISOString()));
    if (!row) break;
    summary.checked++;

    const messageId = row.provider_message_id;
    if (!messageId || !provider.isConfigured()) {
      await deferReconcile(row);
      summary.stillPending++;
      continue;
    }

    const status = await provider.getDeliveryStatus(messageId);

    // 조회 실패 — 전달 실패가 아니다. 문자 대체를 하지 않고 다시 확인한다.
    if (status.outcome === "unknown" || status.outcome === "pending") {
      if (row.reconcile_attempts >= MAX_RECONCILE_ATTEMPTS) {
        await outbox.markResult(row.id, {
          status: "failed", failed_at: new Date().toISOString(),
          last_error_code: "DELIVERY_UNKNOWN",
          last_error_message: "전송 결과를 확인하지 못했습니다.",
        });
        summary.failed++;
        continue;
      }
      await deferReconcile(row);
      summary.stillPending++;
      continue;
    }

    if (row.status === "fallback_submitted") {
      if (status.outcome === "delivered") {
        await outbox.markResult(row.id, {
          status: "fallback_delivered", delivered_at: new Date().toISOString(),
          provider_status: status.providerStatus ?? null, next_reconcile_at: null,
        });
        summary.delivered++;
      } else {
        await outbox.markResult(row.id, {
          status: "failed", failed_at: new Date().toISOString(),
          last_error_code: status.providerStatus ?? "FALLBACK_FAILED",
          last_error_message: status.reason ?? "문자 전송 실패",
          next_reconcile_at: null,
        });
        summary.failed++;
      }
      continue;
    }

    // awaiting_delivery (알림톡)
    if (status.outcome === "delivered") {
      await outbox.markResult(row.id, {
        status: "delivered", delivered_at: new Date().toISOString(),
        provider_status: status.providerStatus ?? null, next_reconcile_at: null,
      });
      summary.delivered++;
      continue;
    }

    // 알림톡 전달 실패 → 문자 대체 (정확히 1회)
    const began = await outbox.tryBeginFallback(row.id, new Date().toISOString());
    if (!began) {
      summary.stillPending++;
      continue;
    }
    await outbox.markResult(row.id, {
      last_error_code: status.providerStatus ?? "KAKAO_DELIVERY_FAILED",
      last_error_message: status.reason ?? "알림톡 전달 실패",
    });

    const payload = JSON.parse(row.payload_snapshot ?? "{}") as Record<string, unknown>;
    const to = String(payload.customerPhone ?? "");
    const { text } = buildMessage(row.event_type as NotificationEvent, payload);
    if (!to) {
      await outbox.markResult(row.id, {
        status: "failed", failed_at: new Date().toISOString(),
        last_error_code: "NO_RECIPIENT", next_reconcile_at: null,
      });
      summary.failed++;
      continue;
    }

    console.warn(
      `[notify] kakao delivery failed event=${row.event_type} to=${maskPhone(to)} status=${status.providerStatus ?? "-"}`
    );
    const sms = await provider.sendSms({ to, text });
    if (sms.accepted) {
      await outbox.markResult(row.id, {
        status: "fallback_submitted", actual_channel: resolveTextChannel(text),
        provider_message_id: sms.providerMessageId ?? null,
        fallback_message_id: sms.providerMessageId ?? null,
        submitted_at: new Date().toISOString(),
        next_reconcile_at: new Date(Date.now() + 60_000).toISOString(),
      });
      summary.fellBack++;
    } else {
      await outbox.markResult(row.id, {
        status: "failed", failed_at: new Date().toISOString(),
        last_error_code: sms.errorCode ?? "FALLBACK_SEND_FAILED",
        last_error_message: sms.errorMessage ?? "문자 대체 발송 실패",
        next_reconcile_at: null,
      });
      summary.failed++;
    }
  }
  return summary;
}

/** 다음 결과 확인 시각을 뒤로 민다 (지수 backoff, 최대 30분) */
async function deferReconcile(row: outbox.OutboxRow): Promise<void> {
  const minutes = Math.min(30, 2 ** Math.max(0, row.reconcile_attempts - 1));
  await outbox.markResult(row.id, {
    next_reconcile_at: new Date(Date.now() + minutes * 60_000).toISOString(),
  });
}
