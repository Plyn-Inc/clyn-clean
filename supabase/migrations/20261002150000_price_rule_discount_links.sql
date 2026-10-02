-- CLYN CLEAN: price rule ↔ discount multi-select mapping
-- Discount definitions live in discount_promotions.
-- A price item can select zero or more discounts, and selected discounts stack in sort order.

CREATE TABLE IF NOT EXISTS public.price_rule_discounts (
  price_rule_id INTEGER NOT NULL REFERENCES public.price_rules(id) ON DELETE CASCADE,
  promotion_id INTEGER NOT NULL REFERENCES public.discount_promotions(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (price_rule_id, promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_price_rule_discounts_promotion
  ON public.price_rule_discounts(promotion_id);

ALTER TABLE public.price_rule_discounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.price_rule_discounts FROM anon, authenticated;

-- Preserve existing promotion targeting by translating service/product conditions
-- into explicit price-item links. Re-running is safe because of the primary key.
INSERT INTO public.price_rule_discounts (price_rule_id, promotion_id, sort_order)
SELECT pr.id, dp.id, 0
  FROM public.discount_promotions dp
  JOIN public.price_rules pr
    ON (dp.service_type IS NULL OR pr.service_type = dp.service_type)
   AND (dp.product_key IS NULL OR pr.product_key = dp.product_key)
ON CONFLICT (price_rule_id, promotion_id) DO NOTHING;
