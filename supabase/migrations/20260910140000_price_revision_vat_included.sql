-- ============================================================================
-- Clyn Clean — 최종 가격 개정 (부가세 포함 고객 표시금액)
--
-- 기준: types.ts의 DEFAULT_BASE_PRICE_BY_HOUSE_TYPE (단일 가격 원천)
-- 고객에게 표시되는 모든 금액은 부가세가 포함된 최종 표시금액이다.
--
-- 40평 이상:
--   DB에는 기준 시작가 579,000원을 그대로 저장한다.
--   다만 확정 자동견적 상품이 아니므로 애플리케이션이
--   consultRequired = true / priceConfirmed = false 로 처리하고
--   고객에게는 "579,000원부터"로만 표시한다 (pricing.ts).
--
-- 안전성:
--   - 기존 migration 파일을 수정하지 않고 신규 파일로 추가
--   - UPDATE만 수행, DROP/DELETE 없음
--   - 예약 snapshot(base_price_snapshot 등)에는 영향 없음
--   - 재실행 안전 (idempotent)
-- ============================================================================

UPDATE public.price_rules SET base_price = 179000 WHERE service_type = '입주청소' AND note = '원룸';
UPDATE public.price_rules SET base_price = 239000 WHERE service_type = '입주청소' AND note = '원룸 복층';
UPDATE public.price_rules SET base_price = 249000 WHERE service_type = '입주청소' AND note = '1.5룸';
UPDATE public.price_rules SET base_price = 269000 WHERE service_type = '입주청소' AND note = '투룸';
UPDATE public.price_rules SET base_price = 319000 WHERE service_type = '입주청소' AND note = '쓰리룸';
UPDATE public.price_rules SET base_price = 329000 WHERE service_type = '입주청소' AND note = '18평';
UPDATE public.price_rules SET base_price = 369000 WHERE service_type = '입주청소' AND note = '24평';
UPDATE public.price_rules SET base_price = 420000 WHERE service_type = '입주청소' AND note = '28평';
UPDATE public.price_rules SET base_price = 459000 WHERE service_type = '입주청소' AND note = '32평';
UPDATE public.price_rules SET base_price = 489000 WHERE service_type = '입주청소' AND note = '34평';
UPDATE public.price_rules SET base_price = 539000 WHERE service_type = '입주청소' AND note = '38평';
-- 40평은 상담 참고 시작가. 확정 견적으로 사용하지 않는다.
UPDATE public.price_rules SET base_price = 579000 WHERE service_type = '입주청소' AND note = '40평';

-- 1.5룸이 아직 없는 환경(초기 migration만 적용된 DB)을 위한 보정
INSERT INTO public.price_rules (service_type, area_min, area_max, base_price, deposit_amount, is_active, note)
SELECT '입주청소', 0, NULL, 249000, 60000, 1, '1.5룸'
WHERE NOT EXISTS (
  SELECT 1 FROM public.price_rules WHERE service_type = '입주청소' AND note = '1.5룸'
);

COMMENT ON COLUMN public.price_rules.base_price IS
  '기본 청소금액(원). 고객 표시 기준이며 부가세가 포함된 금액이다. 40평은 상담 참고 시작가.';
