import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { findByEventKey, requeue } from "@/database/repositories/outbox-repository";
import { queryRow } from "@/database/connection";

/**
 * 실패한 알림 재시도.
 *
 * 새 outbox 이벤트를 만들지 않고 기존 row를 retry_pending으로 되돌린다.
 *
 * **재시도 허용 상태를 allowlist로 제한한다.**
 * provider에 이미 접수된 상태(submitted / awaiting_delivery / fallback_submitted)를
 * 되돌리면 같은 메시지가 다시 sendKakao/sendSms로 진입해 실제 중복 발송이 된다.
 * 따라서 "전송 실패가 확정되어 다시 보내도 안전한 상태"에서만 허용한다.
 *
 *   허용: failed
 *         retry_pending (아직 provider에 접수되지 않았고, 다음 시도를 앞당기는 것뿐)
 *
 *   금지: pending            아직 처리 전 — 곧 자동 발송된다
 *         processing         처리 중
 *         submitted          provider 접수됨
 *         awaiting_delivery  알림톡 접수 후 전달 결과 확인 중
 *         kakao_failed       문자 대체 처리 중
 *         fallback_submitted 문자 provider 접수됨
 *         delivered / fallback_delivered  전송 완료
 */
const RETRYABLE_STATUSES = new Set(["failed", "retry_pending"]);

/** 상태별 거절 사유 — 관리자가 왜 막혔는지 알 수 있어야 한다 */
const BLOCK_REASON: Record<string, { code: string; message: string }> = {
  pending: { code: "NOT_RETRYABLE_PENDING", message: "아직 발송 대기 중입니다. 곧 자동으로 발송됩니다." },
  processing: { code: "NOT_RETRYABLE_IN_PROGRESS", message: "발송 처리 중입니다. 잠시 후 다시 확인해주세요." },
  submitted: { code: "ALREADY_SUBMITTED", message: "이미 발송이 요청된 알림입니다." },
  awaiting_delivery: { code: "ALREADY_SUBMITTED", message: "이미 발송이 요청되어 전송 결과를 확인 중입니다." },
  kakao_failed: { code: "FALLBACK_IN_PROGRESS", message: "문자 대체 발송을 처리 중입니다." },
  fallback_submitted: { code: "ALREADY_SUBMITTED", message: "문자 대체 발송이 이미 요청되었습니다." },
  delivered: { code: "ALREADY_DELIVERED", message: "이미 전송이 완료된 알림입니다." },
  fallback_delivered: { code: "ALREADY_DELIVERED", message: "이미 전송이 완료된 알림입니다." },
};
export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const row = await queryRow<{ id: number; status: string; event_key: string }>(
    "SELECT id, status, event_key FROM notification_outbox WHERE id = ?",
    [id]
  );
  if (!row) return NextResponse.json({ error: "발송 이력을 찾을 수 없습니다." }, { status: 404 });

  if (!RETRYABLE_STATUSES.has(row.status)) {
    const reason = BLOCK_REASON[row.status] ?? {
      code: "NOT_RETRYABLE",
      message: "현재 상태에서는 재시도할 수 없습니다.",
    };
    return NextResponse.json(
      { error: reason.message, code: reason.code, status: row.status },
      { status: 409 }
    );
  }

  await requeue(id);
  // 새 이벤트가 생기지 않았는지 확인 (event_key는 그대로여야 한다)
  const after = await findByEventKey(row.event_key);
  return NextResponse.json({ ok: true, status: after?.status ?? "retry_pending" });
}
