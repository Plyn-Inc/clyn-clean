-- ============================================================================
-- Clyn Clean — settings.balance_notice 부가세 포함 정책 반영
--
-- 구 값 "잔금은 작업 완료 후 현장에서 안내드립니다."가 남아 있으면
-- 고객 견적 안내에 다시 노출될 수 있으므로 forward migration으로 갱신한다.
--
-- 안전성:
--   - 기존 migration 파일 수정 없음 (이미 적용됐을 수 있음)
--   - 행이 없으면 INSERT, 있으면 UPDATE (어느 DB 상태에서도 재실행 안전)
--   - DROP/DELETE 없음
-- ============================================================================

INSERT INTO public.settings (key, value)
VALUES ('balance_notice', '표시 금액은 부가세가 포함된 금액입니다.')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = CURRENT_TIMESTAMP;
