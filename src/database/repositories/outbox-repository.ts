import { execute, executeReturningCount, getDatabaseBackend, queryRow, queryRows } from "../connection";

/**
 * 발송 상태.
 *
 * pending            발송 대기
 * processing         처리 중
 * submitted          provider가 요청을 접수함 (수신 확인 아님)
 * awaiting_delivery  알림톡 접수 후 실제 전달 결과 확인 중
 * delivered          전송 완료 (실제 수신 확인)
 * kakao_failed       알림톡 전달 실패 — 문자 대체 대상
 * fallback_submitted 문자 대체 발송 요청됨
 * fallback_delivered 문자 대체 전송 완료
 * retry_pending      재시도 대기
 * failed             발송 실패 (영구)
 */
export type OutboxStatus =
  | "pending" | "processing" | "submitted" | "awaiting_delivery" | "delivered"
  | "retry_pending" | "failed"
  | "kakao_failed" | "fallback_submitted" | "fallback_delivered";

export interface OutboxRow {
  id: number;
  reservation_id: number | null;
  event_type: string;
  event_key: string;
  template_key: string | null;
  status: OutboxStatus;
  preferred_channel: string;
  actual_channel: string | null;
  attempts: number;
  next_attempt_at: string | null;
  provider: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  payload_snapshot: string | null;
  kakao_message_id: string | null;
  fallback_message_id: string | null;
  fallback_started_at: string | null;
  reconcile_attempts: number;
  next_reconcile_at: string | null;
  created_at: string;
  processing_started_at: string | null;
  submitted_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
}

/**
 * outbox row를 생성한다.
 *
 * **business transaction 안에서 호출한다.** 외부 발송은 여기서 하지 않는다.
 * event_key UNIQUE 때문에 같은 이벤트가 두 번 생성되지 않는다.
 * 이미 존재하면 조용히 무시한다 (retry·더블클릭 대응).
 */
export async function enqueue(input: {
  reservationId: number | null;
  eventType: string;
  templateKey: string | null;
  payload: unknown;
}): Promise<void> {
  const eventKey = `${input.eventType}:${input.reservationId ?? "none"}`;
  const conflict =
    getDatabaseBackend() === "postgres"
      ? "ON CONFLICT (event_key) DO NOTHING"
      : "ON CONFLICT (event_key) DO NOTHING";
  await execute(
    `INSERT INTO notification_outbox
       (reservation_id, event_type, event_key, template_key, status, preferred_channel, payload_snapshot)
     VALUES (?, ?, ?, ?, 'pending', 'kakao', ?)
     ${conflict}`,
    [
      input.reservationId, input.eventType, eventKey, input.templateKey,
      JSON.stringify(input.payload ?? {}),
    ]
  );
}

export function findByEventKey(eventKey: string): Promise<OutboxRow | undefined> {
  return queryRow<OutboxRow>("SELECT * FROM notification_outbox WHERE event_key = ?", [eventKey]);
}

export function listByReservation(reservationId: number): Promise<OutboxRow[]> {
  return queryRows<OutboxRow>(
    "SELECT * FROM notification_outbox WHERE reservation_id = ? ORDER BY id DESC",
    [reservationId]
  );
}

const DISPATCHABLE = `('pending', 'retry_pending')`;

/**
 * 발송 대상 하나를 집어 processing으로 잠근다.
 *
 * PostgreSQL에서는 FOR UPDATE SKIP LOCKED로 serverless instance 여러 개가
 * 같은 row를 동시에 가져가지 못하게 한다.
 *
 * **호출부가 transaction 안에서 실행해야 잠금이 유효하다.**
 */
export async function claimNext(now: string): Promise<OutboxRow | undefined> {
  if (getDatabaseBackend() === "postgres") {
    const rows = await queryRows<OutboxRow>(
      `SELECT * FROM notification_outbox
        WHERE status IN ${DISPATCHABLE}
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [now]
    );
    const row = rows[0];
    if (!row) return undefined;
    await execute(
      `UPDATE notification_outbox
          SET status = 'processing', processing_started_at = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ?`,
      [now, now, row.id]
    );
    return { ...row, status: "processing", attempts: row.attempts + 1 };
  }

  // SQLite: 단일 연결 + withTransaction 직렬화로 보호된다
  const row = await queryRow<OutboxRow>(
    `SELECT * FROM notification_outbox
      WHERE status IN ${DISPATCHABLE}
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY id ASC LIMIT 1`,
    [now]
  );
  if (!row) return undefined;
  await execute(
    `UPDATE notification_outbox
        SET status = 'processing', processing_started_at = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status IN ${DISPATCHABLE}`,
    [now, now, row.id]
  );
  return { ...row, status: "processing", attempts: row.attempts + 1 };
}

export function markResult(id: number, patch: Partial<OutboxRow>): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    params.push(v as unknown);
  }
  fields.push("updated_at = datetime('now')");
  params.push(id);
  return execute(`UPDATE notification_outbox SET ${fields.join(", ")} WHERE id = ?`, params);
}

/** Admin 재시도 — 새 이벤트를 만들지 않고 같은 row를 다시 대기 상태로 돌린다 */
export function requeue(id: number): Promise<void> {
  return execute(
    `UPDATE notification_outbox
        SET status = 'retry_pending', next_attempt_at = NULL,
            last_error_code = NULL, last_error_message = NULL,
            updated_at = datetime('now')
      WHERE id = ?`,
    [id]
  );
}


/**
 * 전달 결과 확인 대상 하나를 집는다.
 *
 * PostgreSQL에서는 FOR UPDATE SKIP LOCKED로 cron instance 여러 개가
 * 같은 row를 동시에 reconcile하지 못하게 한다.
 * **호출부가 transaction 안에서 실행해야 잠금이 유효하다.**
 */
export async function claimForReconcile(now: string): Promise<OutboxRow | undefined> {
  const WHERE = `status IN ('awaiting_delivery', 'fallback_submitted')
                 AND (next_reconcile_at IS NULL OR next_reconcile_at <= ?)`;

  if (getDatabaseBackend() === "postgres") {
    const rows = await queryRows<OutboxRow>(
      `SELECT * FROM notification_outbox
        WHERE ${WHERE}
        ORDER BY id ASC LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [now]
    );
    const row = rows[0];
    if (!row) return undefined;
    await execute(
      `UPDATE notification_outbox
          SET reconcile_attempts = reconcile_attempts + 1, updated_at = ?
        WHERE id = ?`,
      [now, row.id]
    );
    return { ...row, reconcile_attempts: row.reconcile_attempts + 1 };
  }

  const row = await queryRow<OutboxRow>(
    `SELECT * FROM notification_outbox WHERE ${WHERE} ORDER BY id ASC LIMIT 1`,
    [now]
  );
  if (!row) return undefined;
  await execute(
    `UPDATE notification_outbox SET reconcile_attempts = reconcile_attempts + 1, updated_at = ?
      WHERE id = ?`,
    [now, row.id]
  );
  return { ...row, reconcile_attempts: row.reconcile_attempts + 1 };
}

/**
 * 문자 대체 시작을 원자적으로 표시한다.
 *
 * fallback_started_at이 비어 있을 때만 세팅되므로, 같은 실패 결과를 두 번 읽어도
 * 문자는 정확히 1회만 발송된다. 세팅에 성공한 쪽만 true를 받는다.
 */
export async function tryBeginFallback(id: number, now: string): Promise<boolean> {
  const changed = await executeReturningCount(
    `UPDATE notification_outbox
        SET fallback_started_at = ?, status = 'kakao_failed', updated_at = ?
      WHERE id = ? AND fallback_started_at IS NULL`,
    [now, now, id]
  );
  return changed > 0;
}
