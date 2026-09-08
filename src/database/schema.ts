import { getDb } from "./connection";

export function migrate() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_days (
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL DEFAULT 'all_day',
      status TEXT NOT NULL DEFAULT 'available',
      capacity INTEGER NOT NULL DEFAULT 1,
      memo TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (date, time_slot)
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_code TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      service_type TEXT NOT NULL,
      region TEXT NOT NULL,
      address TEXT NOT NULL,
      area_pyeong REAL,
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
      instant_discount_eligible INTEGER NOT NULL DEFAULT 0,
      instant_discount_applied INTEGER NOT NULL DEFAULT 0,
      privacy_agreed INTEGER NOT NULL DEFAULT 0,
      privacy_agreed_at TEXT,
      reservation_status TEXT NOT NULL DEFAULT 'received',
      admin_memo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      payment_method TEXT NOT NULL DEFAULT 'manual_bank_transfer',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      amount INTEGER NOT NULL,
      depositor_name TEXT,
      payment_due_date TEXT,
      confirmed_at TEXT,
      confirmed_by_admin_id INTEGER REFERENCES admins(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS confirmation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES admins(id),
      admin_name TEXT,
      action TEXT NOT NULL,
      prev_status TEXT,
      next_status TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS price_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      area_min REAL NOT NULL DEFAULT 0,
      area_max REAL,
      base_price INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS option_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      option_key TEXT UNIQUE NOT NULL,
      option_label TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      service_type TEXT NOT NULL,
      region TEXT NOT NULL,
      area_pyeong REAL,
      content TEXT NOT NULL,
      before_photo_url TEXT,
      after_photo_url TEXT,
      is_published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      cover_image_url TEXT,
      seo_title TEXT,
      seo_description TEXT,
      is_published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(reservation_status);
    CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(desired_date);
    CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_logs_reservation ON confirmation_logs(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_price_rules_service ON price_rules(service_type, area_min);
  `);

  runIncrementalMigrations();
  seedDefaultSettings();
  seedPriceRules();
  seedOptionPrices();
}

function runIncrementalMigrations() {
  const tryExec = (sql: string) => {
    try { getDb().exec(sql); } catch { /* already applied */ }
  };

  tryExec("ALTER TABLE reservations ADD COLUMN time_slot TEXT NOT NULL DEFAULT 'all_day'");
  tryExec("ALTER TABLE admins ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  tryExec("ALTER TABLE reservations ADD COLUMN estimated_total_snapshot INTEGER");
  tryExec("ALTER TABLE reservations ADD COLUMN estimated_balance_snapshot INTEGER");
  tryExec("ALTER TABLE reservations ADD COLUMN privacy_agreed INTEGER NOT NULL DEFAULT 0");
  tryExec("ALTER TABLE reservations ADD COLUMN privacy_agreed_at TEXT");
  tryExec("ALTER TABLE confirmation_logs ADD COLUMN prev_status TEXT");
  tryExec("ALTER TABLE confirmation_logs ADD COLUMN next_status TEXT");
  tryExec("ALTER TABLE reservations ADD COLUMN house_type_key TEXT");
  tryExec("ALTER TABLE reservations ADD COLUMN price_multiplier REAL NOT NULL DEFAULT 1.0");
  // 미확정 견적/최종금액 컬럼
  tryExec("ALTER TABLE reservations ADD COLUMN price_confirmed_snapshot INTEGER");
  tryExec("ALTER TABLE reservations ADD COLUMN final_confirmed_total INTEGER");
  tryExec("ALTER TABLE reservations ADD COLUMN option_breakdown_snapshot TEXT");
}

function seedDefaultSettings() {
  const defaultSettings: Record<string, string> = {
    base_price_TODO: "0",            // 레거시 — 더 이상 사용 안 함
    deposit_amount: "0",              // 선입금 금액 (미확정 시 0 — 관리자 설정)
    instant_discount_amount: "10000",
    instant_discount_enabled: "0",   // 명세 12: 즉시예약 할인 기본 OFF
    balance_notice: "잔금은 작업 완료 후 현장에서 안내드립니다.",
    bank_name: "",
    bank_account_number: "",
    bank_account_holder: "",
    payment_due_hours: "24",
    default_daily_capacity: "1",     // 한 팀 오전 1집 + 오후 1집 = 하루 최대 2집
    company_name: "Clyn Clean",
    company_phone: "",
    company_kakao_url: "",
    company_address: "",
    company_biz_number: "",
    site_title: "Clyn Clean 입주청소",
    site_description: "입주청소 자동견적 후 예약하세요. 스팀 위생케어, 피톤치드, 코팅 기본 제공.",
    privacy_policy_content: "",
    terms_content: "",
    refund_policy_content: "취소 및 환불 정책은 예약 확정 후 안내드립니다.",
  };

  const existing = getDb().prepare("SELECT key FROM settings").all() as { key: string }[];
  const existingKeys = new Set(existing.map((r) => r.key));
  const insert = getDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaultSettings)) {
    if (!existingKeys.has(key)) insert.run(key, value);
  }

  // instant_discount_enabled는 seed 시 기본 "0"으로 삽입됩니다.
  // 관리자가 ON으로 변경한 경우 그 값을 유지합니다 (강제 다운그레이드 없음).
}

/**
 * 입주청소 기준가격 seed.
 * note 컬럼에 주택유형 key를 저장하여 pricing.ts에서 조회합니다.
 * 이미 존재하는 항목은 업데이트하지 않습니다 (관리자가 수정한 경우 보존).
 */
function seedPriceRules() {
  const houseTypePrices: [string, number][] = [
    ["원룸", 179000],
    ["원룸 복층", 279000],
    ["투룸", 269000],
    ["쓰리룸", 319000],
    ["18평", 329000],
    ["24평", 369000],
    ["28평", 420000],
    ["32평", 459000],
    ["34평", 489000],
    ["38평", 539000],
    ["40평", 579000],
  ];

  const existingNotes = new Set(
    (getDb().prepare("SELECT note FROM price_rules WHERE service_type='입주청소'").all() as { note: string }[])
      .map((r) => r.note)
  );

  const insert = getDb().prepare(
    "INSERT INTO price_rules (service_type, area_min, area_max, base_price, is_active, note) VALUES (?, ?, ?, ?, 1, ?)"
  );

  for (const [key, price] of houseTypePrices) {
    if (!existingNotes.has(key)) {
      // area_min/max는 사용하지 않고 note 키로 조회
      insert.run("입주청소", 0, null, price, key);
    }
  }
}

/**
 * 추가옵션 seed — 새 키 추가, 기존 키는 유지
 */
function seedOptionPrices() {
  const options: [string, string, number][] = [
    // 추가청소
    ["appliance_inside", "가전 내부청소", 0],
    ["extra_furniture", "추가 가구", 0],
    ["hidden_closet", "도면에 없는 붙박이장", 0],
    ["hidden_storage", "도면에 없는 수납장", 0],
    ["extra_pantry", "추가 팬트리", 0],
    ["heavy_mold", "심한 곰팡이", 0],
    ["heavy_stain", "심한 오염", 0],
    ["outer_window", "외창/특수청소", 0],
    ["pet_extra", "반려동물 오염 추가청소", 0],
    // 교체 / 간단 보수
    ["hood_filter", "주방 후드 철망/필터 교체", 0],
    ["drain_trap", "배수구 트랩 새제품 교체", 0],
    ["parts_replace", "기타 소모성 부품 교체", 0],
    ["minor_repair", "간단 집수리", 0],
    ["silicone_repair", "부분 실리콘 보수/재시공", 0],
  ];

  const existingKeys = new Set(
    (getDb().prepare("SELECT option_key FROM option_prices").all() as { option_key: string }[])
      .map((r) => r.option_key)
  );

  const insert = getDb().prepare(
    "INSERT INTO option_prices (option_key, option_label, price) VALUES (?, ?, ?)"
  );

  for (const [key, label, price] of options) {
    if (!existingKeys.has(key)) insert.run(key, label, price);
  }
}

migrate();
