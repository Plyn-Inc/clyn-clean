-- ============================================================================
-- Clyn Clean — 2026-09 가격 개정 및 1.5룸 상품 추가
--
-- 변경 요약:
--   1. 1.5룸 상품 신규 추가 (229,000원 / 예약금 60,000원)
--   2. 전 상품 기본 청소금액 개정 (VAT 별도)
--   3. 예약금 재확인 (원룸~24평 60,000 / 28~34평 70,000 / 38평 80,000 / 40평+ 90,000)
--   4. 동의 증빙 컬럼 추가 (3종 동의 개별 저장 + 버전 + 시각)
--   5. 최소 고객정보(작업지역) 컬럼 추가
--   6. 계좌 안내 시각 / 입금기한 만료 추적 컬럼 추가
--
-- 안전성:
--   - DROP / DELETE 없음
--   - 기존 migration 파일 수정 없음
--   - ADD COLUMN IF NOT EXISTS 로 재실행 안전
--   - 가격은 UPDATE만 수행하며 예약 snapshot에는 영향 없음
-- ============================================================================

-- 1) 1.5룸 신규 상품 -----------------------------------------------------------
INSERT INTO public.price_rules (service_type, area_min, area_max, base_price, deposit_amount, is_active, note)
SELECT '입주청소', 0, NULL, 229000, 60000, 1, '1.5룸'
WHERE NOT EXISTS (
  SELECT 1 FROM public.price_rules WHERE service_type = '입주청소' AND note = '1.5룸'
);

-- 2) 기본 청소금액 개정 (VAT 별도) -------------------------------------------------
UPDATE public.price_rules SET base_price = 169000 WHERE service_type = '입주청소' AND note = '원룸';
UPDATE public.price_rules SET base_price = 219000 WHERE service_type = '입주청소' AND note = '원룸 복층';
UPDATE public.price_rules SET base_price = 229000 WHERE service_type = '입주청소' AND note = '1.5룸';
UPDATE public.price_rules SET base_price = 249000 WHERE service_type = '입주청소' AND note = '투룸';
UPDATE public.price_rules SET base_price = 299000 WHERE service_type = '입주청소' AND note = '쓰리룸';
UPDATE public.price_rules SET base_price = 309000 WHERE service_type = '입주청소' AND note = '18평';
UPDATE public.price_rules SET base_price = 339000 WHERE service_type = '입주청소' AND note = '24평';
UPDATE public.price_rules SET base_price = 389000 WHERE service_type = '입주청소' AND note = '28평';
UPDATE public.price_rules SET base_price = 419000 WHERE service_type = '입주청소' AND note = '32평';
UPDATE public.price_rules SET base_price = 449000 WHERE service_type = '입주청소' AND note = '34평';
UPDATE public.price_rules SET base_price = 490000 WHERE service_type = '입주청소' AND note = '38평';
UPDATE public.price_rules SET base_price = 529000 WHERE service_type = '입주청소' AND note = '40평';

-- 3) 예약금 재확인 (0인 행만 채움 — 관리자 수정값 보존) ---------------------------------
UPDATE public.price_rules SET deposit_amount = 60000
 WHERE service_type = '입주청소'
   AND note IN ('원룸','원룸 복층','1.5룸','투룸','쓰리룸','18평','24평')
   AND deposit_amount = 0;
UPDATE public.price_rules SET deposit_amount = 70000
 WHERE service_type = '입주청소' AND note IN ('28평','32평','34평') AND deposit_amount = 0;
UPDATE public.price_rules SET deposit_amount = 80000
 WHERE service_type = '입주청소' AND note = '38평' AND deposit_amount = 0;
UPDATE public.price_rules SET deposit_amount = 90000
 WHERE service_type = '입주청소' AND note = '40평' AND deposit_amount = 0;

-- 4) 서비스 동의 증빙 (3종 개별 저장) ------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS core_principles_agreed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS service_terms_agreed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS additional_charge_agreed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS agreement_version TEXT;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS agreed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.reservations.agreement_version IS
  '동의 시점의 서비스 동의서 버전. 동의서가 개정되어도 과거 예약 값은 변경하지 않는다.';

-- 5) 최소 고객정보 — 작업지역(행정구역 동 기준) -----------------------------------------
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS area_sido TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS area_sigungu TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS area_dong TEXT;

-- 6) 계좌 안내 / 입금기한 만료 추적 -----------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS account_revealed_at TIMESTAMPTZ;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS deposit_expired_at TIMESTAMPTZ;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS auto_released INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.reservations.account_revealed_at IS
  '예약금 입금 계좌를 고객에게 안내한 시각. 입금기한 24시간의 기준점.';
COMMENT ON COLUMN public.reservations.auto_released IS
  '24시간 미입금으로 슬롯이 자동 해제됐는지 여부. 예약 row는 삭제하지 않고 기록으로 남긴다.';

CREATE INDEX IF NOT EXISTS idx_reservations_account_revealed_at
  ON public.reservations(account_revealed_at);
