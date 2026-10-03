CREATE TABLE IF NOT EXISTS public.notices (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  notice_type TEXT NOT NULL DEFAULT 'normal',
  is_published INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_popup INTEGER NOT NULL DEFAULT 0,
  publish_start_at TIMESTAMPTZ,
  publish_end_at TIMESTAMPTZ,
  popup_image_url TEXT,
  popup_link_url TEXT,
  created_by INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS popup_image_url TEXT;

ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS popup_link_url TEXT;

CREATE INDEX IF NOT EXISTS idx_notices_published
  ON public.notices(is_published, publish_start_at, publish_end_at);

REVOKE ALL ON public.notices FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.notices_id_seq FROM anon, authenticated;
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
