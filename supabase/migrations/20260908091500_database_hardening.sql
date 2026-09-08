-- Prevent duplicate fixed-price products and cover administrator foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS ux_price_rules_service_note
  ON public.price_rules(service_type, note)
  WHERE note IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_confirmed_by_admin
  ON public.payments(confirmed_by_admin_id);

CREATE INDEX IF NOT EXISTS idx_logs_admin
  ON public.confirmation_logs(admin_id);
