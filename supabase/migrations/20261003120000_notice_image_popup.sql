ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS popup_image_url TEXT;

ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS popup_link_url TEXT;
