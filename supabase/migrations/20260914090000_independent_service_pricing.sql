-- ============================================================================
-- Clyn Clean — 서비스별 독립 가격 모델 전환
--
-- 변경 요약:
--   1. price_rules에 product_key / balance_amount 컬럼 추가
--   2. 기존 배수(사이청소 1.5 / 거주청소 1.1)로 계산되던 런타임 가격을
--      독립 row로 물리화 (migration 1회용. 이후 runtime 배수 사용 금지)
--   3. 휴일 가산금 관리자 설정 키 추가
--
-- 안전성: ADD COLUMN IF NOT EXISTS / 조건부 INSERT. DROP·DELETE 없음.
-- ============================================================================

ALTER TABLE public.price_rules
  ADD COLUMN IF NOT EXISTS product_key TEXT;

COMMENT ON COLUMN public.price_rules.product_key IS
  '상품 키 (주거형태/평형). service_type과 조합해 유일한 가격 row를 이룬다.';

-- 기존 row의 note를 product_key로 승격
UPDATE public.price_rules SET product_key = note WHERE product_key IS NULL;

-- service_type + product_key 유일성
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_rules_service_product
  ON public.price_rules(service_type, product_key)
  WHERE product_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 사이청소 / 거주청소 독립 가격 물리화 (migration 1회용 배수 계산)
--   사이청소 = 입주청소 × 1.5
--   거주청소 = 입주청소 × 1.1
-- 배포 이후 runtime에는 배수가 존재하지 않는다.
-- ---------------------------------------------------------------------------
INSERT INTO public.price_rules (service_type, area_min, area_max, base_price, deposit_amount, is_active, note, product_key)
SELECT '사이청소', 0, NULL,
       ROUND(p.base_price * 1.5)::INTEGER,
       p.deposit_amount,
       p.is_active,
       p.note,
       p.product_key
  FROM public.price_rules p
 WHERE p.service_type = '입주청소'
   AND p.product_key IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.price_rules x
      WHERE x.service_type = '사이청소' AND x.product_key = p.product_key
   );

INSERT INTO public.price_rules (service_type, area_min, area_max, base_price, deposit_amount, is_active, note, product_key)
SELECT '거주청소', 0, NULL,
       ROUND(p.base_price * 1.1)::INTEGER,
       p.deposit_amount,
       p.is_active,
       p.note,
       p.product_key
  FROM public.price_rules p
 WHERE p.service_type = '입주청소'
   AND p.product_key IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.price_rules x
      WHERE x.service_type = '거주청소' AND x.product_key = p.product_key
   );

-- 집정리 패키지 상품 (평형 아님)
INSERT INTO public.price_rules (service_type, area_min, area_max, base_price, deposit_amount, is_active, note, product_key)
SELECT '집정리', 0, NULL, v.price, v.deposit, 1, v.label, v.key
  FROM (VALUES
    ('1p4h', '1인 / 4시간', 129000, 60000),
    ('2p4h', '2인 / 4시간', 249000, 60000),
    ('3p4h', '3인 / 4시간', 359000, 70000)
  ) AS v(key, label, price, deposit)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.price_rules x
    WHERE x.service_type = '집정리' AND x.product_key = v.key
 );

-- ---------------------------------------------------------------------------
-- 휴일 가산금 관리자 설정 (초기값 30,000원)
-- 토요일·손없는날에는 가산하지 않는다. 일요일/공휴일에만 1회 가산.
-- ---------------------------------------------------------------------------
INSERT INTO public.settings (key, value)
VALUES ('holiday_surcharge', '30000')
ON CONFLICT (key) DO NOTHING;
