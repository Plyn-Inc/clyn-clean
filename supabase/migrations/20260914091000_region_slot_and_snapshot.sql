-- ============================================================================
-- Clyn Clean — 행정구역 / 서비스 가능지역 / 사이청소 슬롯 / 가격 snapshot
--
-- 안전성: 신규 테이블 + ADD COLUMN IF NOT EXISTS. DROP·DELETE 없음.
-- ============================================================================

-- 1) 행정구역 master ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.administrative_areas (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- sido | sigungu | eupmyeondong
  level TEXT NOT NULL,
  parent_code TEXT REFERENCES public.administrative_areas(code),
  is_current INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.administrative_areas IS
  '행정구역 master. 관리자가 임의 문자열로 수정하는 데이터가 아니며 공식 코드 체계를 따른다.';
COMMENT ON COLUMN public.administrative_areas.parent_code IS
  '세종특별자치시처럼 sigungu 단계가 없는 경우 eupmyeondong의 parent가 sido일 수 있다.';

CREATE INDEX IF NOT EXISTS idx_admin_areas_parent ON public.administrative_areas(parent_code);
CREATE INDEX IF NOT EXISTS idx_admin_areas_level ON public.administrative_areas(level);

-- 2) 서비스 가능지역 (시/군/구 단위) ------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_areas (
  sigungu_code TEXT PRIMARY KEY REFERENCES public.administrative_areas(code),
  is_enabled INTEGER NOT NULL DEFAULT 0,
  admin_note TEXT,
  updated_by_admin_id INTEGER REFERENCES public.admins(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.service_areas IS
  '직접 예약 가능한 시/군/구. 비활성 지역 고객은 서비스 지역 외 상담으로 전환한다.';

CREATE INDEX IF NOT EXISTS idx_service_areas_enabled ON public.service_areas(is_enabled);

-- 3) 사이청소 all_day 보호 날짜의 슬롯 재개방 override -------------------------
CREATE TABLE IF NOT EXISTS public.calendar_slot_reopen_overrides (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  -- morning | afternoon
  time_slot TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  source_reservation_id INTEGER REFERENCES public.reservations(id),
  updated_by_admin_id INTEGER REFERENCES public.admins(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (date, time_slot)
);

COMMENT ON TABLE public.calendar_slot_reopen_overrides IS
  '사이청소(all_day) 보호 날짜에서 관리자가 오전/오후를 수동 재개방한 기록. 실제 예약 점유가 override보다 우선한다.';

CREATE INDEX IF NOT EXISTS idx_slot_reopen_date ON public.calendar_slot_reopen_overrides(date);

-- 4) 예약: 사이청소 시간 / 지역 code / 가격 snapshot ---------------------------
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS move_out_time TIMESTAMPTZ;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS move_in_time TIMESTAMPTZ;

COMMENT ON COLUMN public.reservations.move_out_time IS
  '사이청소 전용 — 기존 거주자 퇴거 완료 예정시간. 신규 예약은 extra_notes JSON에 의존하지 않는다.';

-- 행정구역 code snapshot (표시 문자열은 기존 area_* 컬럼 유지)
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS area_sido_code TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS area_sigungu_code TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS area_dong_code TEXT;

-- 가격 snapshot (서비스별 독립 가격 모델)
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS product_key TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS holiday_surcharge_snapshot INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS total_amount_snapshot INTEGER;

COMMENT ON COLUMN public.reservations.total_amount_snapshot IS
  '총 예약금액 = 기본가격 snapshot + 휴일 가산금 snapshot. 가격표 변경과 무관하게 고정된다.';

-- 상담접수에도 지역 code
ALTER TABLE public.consultation_requests ADD COLUMN IF NOT EXISTS area_sido_code TEXT;
ALTER TABLE public.consultation_requests ADD COLUMN IF NOT EXISTS area_sigungu_code TEXT;
ALTER TABLE public.consultation_requests ADD COLUMN IF NOT EXISTS area_dong_code TEXT;
