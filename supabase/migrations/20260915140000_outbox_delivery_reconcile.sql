-- ============================================================================
-- Clyn Clean — 알림톡 비동기 전달 결과 확인 (delivery reconciliation)
--
-- 문제: SOLAPI send()가 성공해도(submitted) 실제 카카오 전달은 나중에 실패할 수 있다.
--       그 경우 SMS/LMS fallback을 실행할 근거가 없었다.
--
-- 해결: submitted → awaiting_delivery로 두고, cron이 SOLAPI getMessages()로
--       실제 결과를 조회해 delivered / kakao_failed(→fallback)를 확정한다.
--
-- 중복 fallback 방지:
--   fallback_started_at이 설정된 row는 다시 문자를 보내지 않는다.
--   PostgreSQL claim(FOR UPDATE SKIP LOCKED)과 함께 이중 방어한다.
--
-- 안전성: 컬럼 추가만. 전부 NULL 허용. 재실행 안전.
-- ============================================================================

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS kakao_message_id TEXT;
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS fallback_message_id TEXT;
/* 문자 대체를 이미 시작했는지 — 같은 실패 결과를 두 번 읽어도 1회만 발송한다 */
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS fallback_started_at TIMESTAMPTZ;
/* 결과 조회 재시도 횟수 (발송 attempts와 분리) */
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS reconcile_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS next_reconcile_at TIMESTAMPTZ;

COMMENT ON COLUMN public.notification_outbox.fallback_started_at IS
  '문자 대체 발송을 시작한 시각. 설정돼 있으면 중복 fallback을 하지 않는다.';

CREATE INDEX IF NOT EXISTS idx_outbox_awaiting_delivery
  ON public.notification_outbox(status, next_reconcile_at);
