-- ============================================================================
-- Clyn Clean — 통합 할인 시스템
--
-- 계산 순서: 정상가 → 자동 프로모션 → 쿠폰 → 관리자 수동 할인 → 최종금액
--   - 자동 프로모션과 쿠폰은 중복 적용 가능
--   - 자동 프로모션은 조건을 만족하는 것 중 "가장 큰 할인 1개"만 적용
--   - 관리자 수동 할인은 예약 생성 이후 adjustment
--
-- 안전성:
--   - 기존 reservations에 NOT NULL을 기본값 없이 추가하지 않는다
--   - 모든 신규 컬럼은 DEFAULT 0 또는 NULL 허용
--   - ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS — 재실행 안전
-- ============================================================================

-- 1) 자동 프로모션 ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discount_promotions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- fixed | percent
  discount_type TEXT NOT NULL DEFAULT 'fixed',
  discount_value INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  -- NULL이면 전체 서비스/상품에 적용
  service_type TEXT,
  product_key TEXT,
  min_amount INTEGER NOT NULL DEFAULT 0,
  /* 정률 할인의 상한. NULL이면 무제한 */
  max_discount_amount INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.discount_promotions IS
  '자동 프로모션. 조건을 만족하는 여러 개 중 고객에게 가장 큰 할인 1개만 적용된다.';

CREATE INDEX IF NOT EXISTS idx_promotions_active ON public.discount_promotions(is_active);

-- 2) 쿠폰 --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupons (
  id SERIAL PRIMARY KEY,
  /* trim + 대문자 정규화된 코드 */
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  discount_type TEXT NOT NULL DEFAULT 'fixed',
  discount_value INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  service_type TEXT,
  product_key TEXT,
  min_amount INTEGER NOT NULL DEFAULT 0,
  max_discount_amount INTEGER,
  /* NULL이면 사용 한도 없음 */
  total_usage_limit INTEGER,
  /* 전화번호 기준 1인 사용 한도. NULL이면 제한 없음 */
  per_phone_limit INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);

-- 3) 쿠폰 사용 기록 -----------------------------------------------------------
-- 예약 저장과 같은 transaction에서 기록된다.
-- reservation_id UNIQUE로 한 예약이 쿠폰을 두 번 쓰지 못하게 한다.
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id SERIAL PRIMARY KEY,
  coupon_id INTEGER NOT NULL REFERENCES public.coupons(id),
  reservation_id INTEGER NOT NULL REFERENCES public.reservations(id),
  customer_phone TEXT,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_redemption_reservation
  ON public.coupon_redemptions(reservation_id);
CREATE INDEX IF NOT EXISTS idx_redemption_coupon ON public.coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_redemption_phone ON public.coupon_redemptions(coupon_id, customer_phone);

-- 4) 관리자 수동 할인 audit ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservation_discount_adjustments (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES public.reservations(id),
  admin_id INTEGER REFERENCES public.admins(id),
  admin_name TEXT,
  discount_type TEXT NOT NULL,
  discount_value INTEGER NOT NULL DEFAULT 0,
  calculated_amount INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  previous_final_amount INTEGER NOT NULL DEFAULT 0,
  new_final_amount INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_adjustments_reservation
  ON public.reservation_discount_adjustments(reservation_id);

-- 5) 예약 할인 snapshot -------------------------------------------------------
-- 전부 DEFAULT 0 / NULL 허용 — 기존 예약 데이터를 깨뜨리지 않는다.
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS original_amount INTEGER;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS automatic_discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS coupon_discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS admin_discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS final_amount INTEGER;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS promotion_id INTEGER;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS promotion_name TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS coupon_id INTEGER;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS admin_discount_reason TEXT;

COMMENT ON COLUMN public.reservations.final_amount IS
  '할인 적용 후 최종 결제금액. 예약 당시 snapshot이며 가격표/프로모션 변경에 영향받지 않는다.';
