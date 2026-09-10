-- ============================================================================
-- Clyn Clean — 예약 승인 프로세스 도입
--
-- 변경 요약:
--   1. price_rules.deposit_amount 컬럼 추가 (평형별 예약 선금)
--   2. 확정 평형별 예약금 값 반영 (기존 행 UPDATE, 신규 생성 없음)
--   3. reservations.approved_at / approved_by_admin_id 컬럼 추가
--
-- 안전성:
--   - DROP TABLE / DELETE 없음
--   - 기존 migration 파일 수정 없음
--   - ADD COLUMN IF NOT EXISTS 로 재실행 안전 (idempotent)
--   - reservation_status에는 CHECK 제약이 없으므로
--     'approved_awaiting_deposit' 값 추가에 스키마 변경이 필요 없음
-- ============================================================================

-- 1) 평형별 예약 선금 컬럼 -----------------------------------------------------
ALTER TABLE public.price_rules
  ADD COLUMN IF NOT EXISTS deposit_amount INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.price_rules.deposit_amount IS
  '평형별 예약 선금(원). 총 청소금액에 포함되며 추가 비용이 아님. 잔금 = 최종금액 - 예약금.';

-- 2) 확정 예약금 반영 ---------------------------------------------------------
--    원룸 ~ 24평: 60,000 / 28 ~ 34평: 70,000 / 38평: 80,000 / 40평 이상: 90,000
--    이미 관리자가 0이 아닌 값으로 수정한 행은 덮어쓰지 않는다.
UPDATE public.price_rules
   SET deposit_amount = 60000
 WHERE service_type = '입주청소'
   AND note IN ('원룸', '원룸 복층', '투룸', '쓰리룸', '18평', '24평')
   AND deposit_amount = 0;

UPDATE public.price_rules
   SET deposit_amount = 70000
 WHERE service_type = '입주청소'
   AND note IN ('28평', '32평', '34평')
   AND deposit_amount = 0;

UPDATE public.price_rules
   SET deposit_amount = 80000
 WHERE service_type = '입주청소'
   AND note = '38평'
   AND deposit_amount = 0;

UPDATE public.price_rules
   SET deposit_amount = 90000
 WHERE service_type = '입주청소'
   AND note = '40평'
   AND deposit_amount = 0;

-- 3) 관리자 승인 이력 ---------------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS approved_by_admin_id INTEGER REFERENCES public.admins(id);

COMMENT ON COLUMN public.reservations.approved_at IS
  '관리자가 예약을 승인하여 예약금 입금 안내를 시작한 시각. 이 시점에 payment가 생성된다.';

-- 4) 승인 대기 예약 조회용 인덱스 ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reservations_approved_at
  ON public.reservations(approved_at);
