-- Clyn Clean production schema for Supabase PostgreSQL.
-- The application connects server-side with DATABASE_URL; Data API roles are denied below.

CREATE TABLE IF NOT EXISTS public.admins (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.calendar_days (
  date TEXT NOT NULL,
  time_slot TEXT NOT NULL DEFAULT 'all_day',
  status TEXT NOT NULL DEFAULT 'available',
  capacity INTEGER NOT NULL DEFAULT 1,
  memo TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (date, time_slot)
);

CREATE TABLE IF NOT EXISTS public.reservations (
  id SERIAL PRIMARY KEY,
  reservation_code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  service_type TEXT NOT NULL,
  region TEXT NOT NULL,
  address TEXT NOT NULL,
  area_pyeong REAL,
  house_type_key TEXT,
  price_multiplier REAL NOT NULL DEFAULT 1.0,
  house_structure TEXT,
  occupancy_status TEXT,
  desired_date TEXT,
  time_slot TEXT NOT NULL DEFAULT 'all_day',
  entry_route TEXT NOT NULL DEFAULT 'direct',
  extra_options TEXT,
  extra_notes TEXT,
  has_site_photos INTEGER NOT NULL DEFAULT 0,
  base_price_snapshot INTEGER,
  extra_price_snapshot INTEGER,
  option_breakdown_snapshot TEXT,
  deposit_amount_snapshot INTEGER,
  instant_discount_snapshot INTEGER,
  estimated_total_snapshot INTEGER,
  estimated_balance_snapshot INTEGER,
  price_confirmed_snapshot INTEGER,
  final_confirmed_total INTEGER,
  instant_discount_eligible INTEGER NOT NULL DEFAULT 0,
  instant_discount_applied INTEGER NOT NULL DEFAULT 0,
  privacy_agreed INTEGER NOT NULL DEFAULT 0,
  privacy_agreed_at TIMESTAMPTZ,
  reservation_status TEXT NOT NULL DEFAULT 'received',
  admin_memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.payments (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL DEFAULT 'manual_bank_transfer',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  amount INTEGER NOT NULL,
  depositor_name TEXT,
  payment_due_date TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmed_by_admin_id INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.confirmation_logs (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES public.admins(id) ON DELETE SET NULL,
  admin_name TEXT,
  action TEXT NOT NULL,
  prev_status TEXT,
  next_status TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.price_rules (
  id SERIAL PRIMARY KEY,
  service_type TEXT NOT NULL,
  area_min REAL NOT NULL DEFAULT 0,
  area_max REAL,
  base_price INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.option_prices (
  id SERIAL PRIMARY KEY,
  option_key TEXT UNIQUE NOT NULL,
  option_label TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reviews (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  service_type TEXT NOT NULL,
  region TEXT NOT NULL,
  area_pyeong REAL,
  content TEXT NOT NULL,
  before_photo_url TEXT,
  after_photo_url TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.posts (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  cover_image_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservations_status ON public.reservations(reservation_status);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON public.reservations(desired_date);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON public.payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_logs_reservation ON public.confirmation_logs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_price_rules_service ON public.price_rules(service_type, area_min);

INSERT INTO public.settings (key, value) VALUES
  ('base_price_TODO', '0'),
  ('deposit_amount', '0'),
  ('instant_discount_amount', '10000'),
  ('instant_discount_enabled', '0'),
  ('balance_notice', '잔금은 작업 완료 후 현장에서 안내드립니다.'),
  ('bank_name', ''),
  ('bank_account_number', ''),
  ('bank_account_holder', ''),
  ('payment_due_hours', '24'),
  ('default_daily_capacity', '1'),
  ('company_name', 'Clyn Clean'),
  ('company_phone', ''),
  ('company_kakao_url', ''),
  ('company_address', ''),
  ('company_biz_number', ''),
  ('site_title', 'Clyn Clean 입주청소'),
  ('site_description', '입주청소 자동견적 후 예약하세요. 스팀 위생케어, 피톤치드, 코팅 기본 제공.'),
  ('privacy_policy_content', ''),
  ('terms_content', ''),
  ('refund_policy_content', '취소 및 환불 정책은 예약 확정 후 안내드립니다.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.price_rules (service_type, area_min, area_max, base_price, is_active, note) VALUES
  ('입주청소', 0, NULL, 179000, 1, '원룸'),
  ('입주청소', 0, NULL, 279000, 1, '원룸 복층'),
  ('입주청소', 0, NULL, 269000, 1, '투룸'),
  ('입주청소', 0, NULL, 319000, 1, '쓰리룸'),
  ('입주청소', 0, NULL, 329000, 1, '18평'),
  ('입주청소', 0, NULL, 369000, 1, '24평'),
  ('입주청소', 0, NULL, 420000, 1, '28평'),
  ('입주청소', 0, NULL, 459000, 1, '32평'),
  ('입주청소', 0, NULL, 489000, 1, '34평'),
  ('입주청소', 0, NULL, 539000, 1, '38평'),
  ('입주청소', 0, NULL, 579000, 1, '40평');

INSERT INTO public.option_prices (option_key, option_label, price, is_active) VALUES
  ('appliance_inside', '가전 내부청소', 0, 1),
  ('extra_furniture', '추가 가구', 0, 1),
  ('hidden_closet', '도면에 없는 붙박이장', 0, 1),
  ('hidden_storage', '도면에 없는 수납장', 0, 1),
  ('extra_pantry', '추가 팬트리', 0, 1),
  ('heavy_mold', '심한 곰팡이', 0, 1),
  ('heavy_stain', '심한 오염', 0, 1),
  ('outer_window', '외창/특수청소', 0, 1),
  ('pet_extra', '반려동물 오염 추가청소', 0, 1),
  ('hood_filter', '주방 후드 철망/필터 교체', 0, 1),
  ('drain_trap', '배수구 트랩 새제품 교체', 0, 1),
  ('parts_replace', '기타 소모성 부품 교체', 0, 1),
  ('minor_repair', '간단 집수리', 0, 1),
  ('silicone_repair', '부분 실리콘 보수/재시공', 0, 1)
ON CONFLICT (option_key) DO NOTHING;

-- This app never accesses business tables through Supabase's public Data API.
-- Deny browser-facing roles and keep server-side PostgreSQL as the only application path.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Defense in depth: no policies are created, so Data API roles cannot read/write these tables.
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.confirmation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.option_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
