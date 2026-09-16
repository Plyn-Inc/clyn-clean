-- Marketing attribution snapshot + PII-free funnel events.
-- Application writes through the server-side DATABASE_URL connection only.

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS first_source TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS first_medium TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS first_campaign TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS first_keyword TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS last_source TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS last_medium TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS last_campaign TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS last_keyword TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS landing_page TEXT;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS first_visit_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reservations_first_source ON public.reservations(first_source);

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id BIGSERIAL PRIMARY KEY,
  reservation_id INTEGER REFERENCES public.reservations(id) ON DELETE SET NULL,
  visitor_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  keyword TEXT,
  landing_page TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marketing_events_visitor
  ON public.marketing_events(visitor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_marketing_events_name
  ON public.marketing_events(event_name, created_at);

-- public schema is exposed by default on Supabase. This table is internal only.
ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.marketing_events_id_seq FROM anon, authenticated;
