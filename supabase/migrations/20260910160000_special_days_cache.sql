-- ============================================================================
-- Clyn Clean — 특수일(special_days) 캐시 테이블
--
-- 공휴일·손없는날의 Production source of truth를 코드 내 정적 목록에서
-- DB 캐시로 전환한다.
--
-- 기준 데이터: 한국천문연구원(KASI) OpenAPI
--   - 특일 정보 (getRestDeInfo)      → 공휴일
--   - 음양력 정보 (getLunCalInfo)     → 손없는날(음력 9·10·19·20·29·30일)
--
-- 원칙:
--   - 고객 요청마다 KASI를 실시간 호출하지 않는다. 배치 동기화 결과만 읽는다.
--   - 데이터가 없는 날짜는 "일반일"로 간주하지 않는다 (조회 측에서 거부).
--   - 관리자 manual override로 임시공휴일 등 긴급 변경에 대응한다.
--   - 토/일은 저장하지 않고 서버가 날짜로 직접 계산한다.
--
-- 안전성: 신규 테이블만 생성. 기존 테이블 변경/삭제 없음.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.special_days (
  date TEXT PRIMARY KEY,
  is_holiday INTEGER NOT NULL DEFAULT 0,
  holiday_name TEXT,
  is_son_eomneun_day INTEGER NOT NULL DEFAULT 0,
  -- kasi | generator | manual
  --   kasi      : KASI OpenAPI 동기화 결과
  --   generator : 오프라인 backfill (개발/테스트/장애 대비)
  --   manual    : 관리자 수동 지정 (임시공휴일 등). 동기화가 덮어쓰지 않는다.
  source TEXT NOT NULL DEFAULT 'kasi',
  admin_note TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.special_days IS
  '공휴일/손없는날 캐시. KASI OpenAPI 동기화 결과이며 고객 요청 시 실시간 호출하지 않는다.';
COMMENT ON COLUMN public.special_days.source IS
  'kasi=API 동기화 / generator=오프라인 backfill / manual=관리자 지정(동기화가 덮어쓰지 않음)';

CREATE INDEX IF NOT EXISTS idx_special_days_synced ON public.special_days(synced_at);
CREATE INDEX IF NOT EXISTS idx_special_days_source ON public.special_days(source);

ALTER TABLE public.special_days ENABLE ROW LEVEL SECURITY;

-- 동기화 상태 기록 (마지막 성공 시각 / 커버 범위)
INSERT INTO public.settings (key, value)
VALUES ('special_days_synced_through', '')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value)
VALUES ('special_days_last_sync_at', '')
ON CONFLICT (key) DO NOTHING;
