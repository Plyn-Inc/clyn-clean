-- ============================================================================
-- Clyn Clean — 공지사항 / 팝업
--
-- 공개 조건:
--   is_published = 1
--   AND (publish_start_at IS NULL OR publish_start_at <= now)
--   AND (publish_end_at   IS NULL OR publish_end_at   >= now)
--
-- content는 평문 multiline 텍스트만 저장한다. HTML을 저장/렌더링하지 않는다(XSS 방지).
-- 안전성: 신규 테이블만 생성. 재실행 안전.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notices (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  /* 평문 multiline. HTML 아님 */
  content TEXT NOT NULL,
  -- normal | urgent
  notice_type TEXT NOT NULL DEFAULT 'normal',
  is_published INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_popup INTEGER NOT NULL DEFAULT 0,
  /* Admin 입력은 Asia/Seoul로 해석해 timestamptz로 저장한다 */
  publish_start_at TIMESTAMPTZ,
  publish_end_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES public.admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE public.notices IS
  '공지사항. is_popup이 켜진 공개 공지만 홈페이지 팝업 후보가 된다.';
COMMENT ON COLUMN public.notices.content IS
  '평문 multiline 텍스트. HTML을 저장하지 않는다.';

CREATE INDEX IF NOT EXISTS idx_notices_published
  ON public.notices(is_published, publish_start_at, publish_end_at);
CREATE INDEX IF NOT EXISTS idx_notices_popup ON public.notices(is_popup, is_published);
