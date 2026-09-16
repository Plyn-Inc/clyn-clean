-- ============================================================================
-- Clyn Clean — 슬롯 중복 예약 원자적 방지
--
-- 문제: 예약 저장 전에 SELECT count로 확인하고 INSERT하면
--       동시 요청 2건이 둘 다 pre-check를 통과해 초과 예약이 생긴다.
--
-- 해결: PostgreSQL advisory lock으로 같은 (날짜, 슬롯) 저장을 직렬화한다.
--       기존 lockReservationSlot()이 이미 이 방식을 쓰므로 인덱스만 보강한다.
--
-- 사이청소(all_day)는 종일 점유이므로 같은 날짜에 활성 예약이 하나라도 있으면
-- 접수할 수 없다. 이 판정을 빠르게 하기 위한 부분 인덱스를 둔다.
--
-- 안전성: 인덱스만 추가. DROP/DELETE 없음. 재실행 안전.
-- ============================================================================

-- 활성 예약만 대상으로 하는 (날짜, 슬롯) 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_reservations_active_slot
  ON public.reservations(desired_date, time_slot)
  WHERE reservation_status IN
    ('received','approved_awaiting_deposit','awaiting_deposit','awaiting_admin_check','confirmed');

COMMENT ON INDEX public.idx_reservations_active_slot IS
  '슬롯 충돌 판정용. advisory lock 구간을 짧게 유지하기 위한 인덱스.';
