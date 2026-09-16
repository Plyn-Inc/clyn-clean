-- ============================================================================
-- Clyn Clean — 알림 outbox (카카오 알림톡 + SMS/LMS fallback)
--
-- 핵심 원칙:
--   외부 provider 호출은 business transaction 밖에서 수행한다.
--   BEGIN → 예약/입금확인/예약확정 처리 + outbox INSERT → COMMIT → (별도) 발송
--   SOLAPI 장애가 이미 완료된 예약/입금확인/예약확정을 rollback시키지 않는다.
--
-- event_key UNIQUE로 retry·더블클릭 시 같은 알림이 두 번 생성되지 않게 한다.
--   예: reservation_received:123 / deposit_confirmed:123 / reservation_confirmed:123
--
-- 안전성: 신규 테이블만 생성. 기존 예약 데이터에 영향 없음. 재실행 안전.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER REFERENCES public.reservations(id),
  -- reservation_received | deposit_confirmed | reservation_confirmed
  event_type TEXT NOT NULL,
  /* "{event_type}:{reservation_id}" — 중복 생성 차단 */
  event_key TEXT NOT NULL,
  template_key TEXT,

  /*
   * 상태 흐름:
   *   pending → processing → submitted → delivered
   *   실패 시 processing → retry_pending → processing
   *   최종 실패: failed
   *   카카오 실패 후 문자 대체: kakao_failed → fallback_submitted → fallback_delivered
   *
   * 주의: provider가 API 요청을 접수한 것은 submitted이지 delivered가 아니다.
   *       실제 수신 확인(delivery report) 전에는 delivered로 기록하지 않는다.
   */
  status TEXT NOT NULL DEFAULT 'pending',
  -- kakao | sms | lms
  preferred_channel TEXT NOT NULL DEFAULT 'kakao',
  actual_channel TEXT,

  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,

  provider TEXT,
  provider_message_id TEXT,
  provider_status TEXT,
  last_error_code TEXT,
  last_error_message TEXT,

  /* 이벤트 생성 시점의 메시지 내용. 이후 예약/계좌 설정이 바뀌어도 변하지 않는다 */
  payload_snapshot TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_event_key
  ON public.notification_outbox(event_key);

/* processor가 FOR UPDATE SKIP LOCKED로 집어갈 대상 조회용 */
CREATE INDEX IF NOT EXISTS idx_outbox_dispatchable
  ON public.notification_outbox(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_outbox_reservation
  ON public.notification_outbox(reservation_id);

COMMENT ON TABLE public.notification_outbox IS
  '알림 발송 outbox. business transaction에서 INSERT하고 발송은 별도 processor가 수행한다.';
COMMENT ON COLUMN public.notification_outbox.status IS
  'submitted = provider가 요청을 접수함. delivered = 실제 수신 확인됨. 둘을 혼동하지 않는다.';
