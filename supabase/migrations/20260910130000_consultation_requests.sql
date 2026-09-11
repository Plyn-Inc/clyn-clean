-- ============================================================================
-- Clyn Clean — 상담접수(consultation_requests) 파이프라인
--
-- 40평 이상 / 반려동물 있음 등 자동예약이 불가한 건을 일반 예약과 분리해 관리한다.
-- 상담접수는 calendar_days 슬롯을 점유하지 않는다.
--
-- 안전성: 신규 테이블만 생성. 기존 테이블 변경/삭제 없음.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.consultation_requests (
  id SERIAL PRIMARY KEY,
  request_code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  -- 작업지역 (행정구역 동 기준)
  area_sido TEXT,
  area_sigungu TEXT,
  area_dong TEXT,
  address TEXT,
  service_type TEXT,
  house_type_key TEXT,
  actual_pyeong REAL,
  preferred_date TEXT,
  preferred_time_slot TEXT,
  -- 상담 전환 사유: size_40_plus | pet | price_unconfirmed | manual
  reason TEXT NOT NULL DEFAULT 'manual',
  -- 반려동물 상세 (JSON)
  pet_meta TEXT,
  extra_notes TEXT,
  -- 상담 참고용 시작가 (확정 견적 아님)
  reference_price INTEGER,
  -- received | contacting | converted | closed
  status TEXT NOT NULL DEFAULT 'received',
  admin_memo TEXT,
  -- 실제 예약으로 전환된 경우 연결
  converted_reservation_id INTEGER REFERENCES public.reservations(id),
  privacy_agreed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.consultation_requests IS
  '상담접수. 일반 예약과 분리되며 캘린더 슬롯을 점유하지 않는다.';
COMMENT ON COLUMN public.consultation_requests.reference_price IS
  '상담 참고용 시작가. 확정 견적이 아니며 고객에게 확정금액으로 표시하지 않는다.';

CREATE INDEX IF NOT EXISTS idx_consultation_status ON public.consultation_requests(status);
CREATE INDEX IF NOT EXISTS idx_consultation_created ON public.consultation_requests(created_at);

ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;
