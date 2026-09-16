-- ============================================================================
-- Clyn Clean — 예약 제출 idempotency
--
-- 문제: 더블클릭·네트워크 재시도로 같은 견적이 두 번 제출되면
--       예약/payment/confirmation_log가 중복 생성된다.
--
-- 해결: /api/quote가 발급하는 quoteId(UUID)를 예약에 저장하고 UNIQUE를 건다.
--       같은 quoteId로 재요청이 오면 새로 만들지 않고 기존 예약 결과를 반환한다.
--       (고객에게 오류가 아니라 동일 성공 응답을 준다)
--
-- 안전성: ADD COLUMN IF NOT EXISTS + partial unique index. DROP/DELETE 없음.
--         기존 예약은 quote_id가 NULL이며 partial index 대상에서 제외된다.
-- ============================================================================

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS quote_id TEXT;

COMMENT ON COLUMN public.reservations.quote_id IS
  '견적 토큰의 quoteId. 같은 값으로 재요청이 와도 예약이 중복 생성되지 않는다.';

-- NULL은 중복 허용해야 하므로 partial unique index를 쓴다
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_quote_id
  ON public.reservations(quote_id)
  WHERE quote_id IS NOT NULL;
