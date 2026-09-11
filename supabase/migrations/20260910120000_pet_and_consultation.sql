-- ============================================================================
-- Clyn Clean — 반려동물 정식 컬럼 분리 및 상담 전환 지원
--
-- 변경 요약:
--   1. reservations.has_pet 컬럼 추가
--      (기존에는 extra_notes의 [내부메타] JSON을 파싱해야 했으나,
--       상담 전환이라는 핵심 정책 판정에 문자열 파싱을 사용하지 않는다)
--   2. reservations.date_adjustment_applied / date_adjustment_amount 추가
--      (날짜 조건 가격 보정 내부 감사용. 고객에게는 노출하지 않는다)
--
-- 안전성: DROP/DELETE 없음, ADD COLUMN IF NOT EXISTS로 재실행 안전
-- ============================================================================

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS has_pet INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.reservations.has_pet IS
  '반려동물 있음 여부. 1이면 상담 전환 대상이며 자동 예약금 단계로 진행하지 않는다.';

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS date_adjustment_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS date_adjustment_amount INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.reservations.date_adjustment_amount IS
  '날짜 조건(토/일/공휴일/손없는날) 내부 가격 보정액. 고객 UI에 사유나 금액을 노출하지 않는다.';
