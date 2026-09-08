// ---------------------------------------------------------------------------
// 도메인 타입 정의
// ---------------------------------------------------------------------------

export type CalendarStatus = "available" | "closed" | "consult_required" | "off";

export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  available: "예약 가능",
  closed: "예약 마감",
  consult_required: "상담 필요",
  off: "휴무",
};

export type TimeSlot = "all_day" | "morning" | "afternoon" | "after_16" | "negotiable";

export const TIME_SLOT_LABEL: Record<TimeSlot, string> = {
  all_day: "시간 미지정",
  morning: "오전",
  afternoon: "오후",
  after_16: "16시 이후",
  negotiable: "시간 협의",
};

export type ReservationStatus =
  | "received"
  | "awaiting_deposit"
  | "awaiting_admin_check"
  | "confirmed"
  | "consult_required"
  | "cancelled"
  | "completed";

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  received: "예약 접수",
  awaiting_deposit: "선입금 대기",
  awaiting_admin_check: "선입금 확인 / 확정 대기",
  confirmed: "예약 확정",
  consult_required: "상담 필요",
  cancelled: "예약 취소",
  completed: "작업 완료",
};

export type PaymentStatus = "pending" | "confirmed" | "unconfirmed" | "refund_required" | "refunded";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "선입금 대기",
  confirmed: "선입금 확인 완료",
  unconfirmed: "선입금 미확인",
  refund_required: "환불 필요",
  refunded: "환불 완료",
};

export type PaymentMethod =
  | "manual_bank_transfer"
  | "pg_card"
  | "virtual_account"
  | "bank_auto_check"
  | "kakao_pay"
  | "naver_pay";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  manual_bank_transfer: "무통장입금(계좌이체)",
  pg_card: "카드결제 (준비 중)",
  virtual_account: "가상계좌 (준비 중)",
  bank_auto_check: "입금 자동확인 (준비 중)",
  kakao_pay: "카카오페이 (준비 중)",
  naver_pay: "네이버페이 (준비 중)",
};

export type EntryRoute = "calendar" | "direct";

export type OccupancyStatus = "before_move_in" | "after_move_out" | "currently_living";

export const OCCUPANCY_STATUS_LABEL: Record<OccupancyStatus, string> = {
  before_move_in: "입주 전",
  after_move_out: "퇴거 후",
  currently_living: "거주 중",
};

// ---------------------------------------------------------------------------
// 오픈 서비스 (4개만 운영)
// ---------------------------------------------------------------------------

export const SERVICE_TYPES = [
  "입주청소",
  "사이청소",
  "거주청소",
  "집정리",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

// ---------------------------------------------------------------------------
// 주택 유형 (입주/사이/거주청소용)
// ---------------------------------------------------------------------------

export const HOUSE_TYPES_FIXED = [
  "원룸",
  "원룸 복층",
  "투룸",
  "쓰리룸",
] as const;

export const HOUSE_SIZES_APARTMENT = [18, 24, 28, 32, 34, 38, 40] as const;

export type HouseTypeFixed = (typeof HOUSE_TYPES_FIXED)[number];
export type HouseSizeApartment = (typeof HOUSE_SIZES_APARTMENT)[number];

/** 아파트/주택 선택 시 사용하는 평형 레이블 */
export const HOUSE_SIZE_LABEL: Record<HouseSizeApartment, string> = {
  18: "18평",
  24: "24평",
  28: "28평",
  32: "32평",
  34: "34평",
  38: "38평",
  40: "40평 이상",
};

// ---------------------------------------------------------------------------
// 집정리 패키지
// ---------------------------------------------------------------------------

export const JIPJEONGRI_PACKAGES = [
  { key: "1p4h", label: "1인 / 4시간", price: 129000 },
  { key: "2p4h", label: "2인 / 4시간", price: 249000 },
  { key: "3p4h", label: "3인 / 4시간", price: 359000 },
] as const;

export type JipjeongriPackageKey = (typeof JIPJEONGRI_PACKAGES)[number]["key"];

export const JIPJEONGRI_SPACES = [
  "옷/드레스룸",
  "주방",
  "팬트리",
  "아이방",
  "기타",
] as const;

// ---------------------------------------------------------------------------
// 추가 옵션 (allowlist — price-rules API가 이 키만 허용)
// ---------------------------------------------------------------------------

export const EXTRA_OPTIONS = [
  // 추가청소
  { key: "appliance_inside", label: "가전 내부청소" },
  { key: "extra_furniture", label: "추가 가구" },
  { key: "hidden_closet", label: "도면에 없는 붙박이장" },
  { key: "hidden_storage", label: "도면에 없는 수납장" },
  { key: "extra_pantry", label: "추가 팬트리" },
  { key: "heavy_mold", label: "심한 곰팡이" },
  { key: "heavy_stain", label: "심한 오염" },
  { key: "outer_window", label: "외창/특수청소" },
  { key: "pet_extra", label: "반려동물 오염 추가청소" },
  // 교체 / 간단 보수
  { key: "hood_filter", label: "주방 후드 철망/필터 교체" },
  { key: "drain_trap", label: "배수구 트랩 새제품 교체" },
  { key: "parts_replace", label: "기타 소모성 부품 교체" },
  { key: "minor_repair", label: "간단 집수리" },
  { key: "silicone_repair", label: "부분 실리콘 보수/재시공" },
] as const;

export type ExtraOptionKey = (typeof EXTRA_OPTIONS)[number]["key"];

// ---------------------------------------------------------------------------
// 반려동물
// ---------------------------------------------------------------------------

export type PetType = "dog" | "cat" | "other";
export const PET_TYPE_LABEL: Record<PetType, string> = {
  dog: "반려견",
  cat: "반려묘",
  other: "기타",
};

// ---------------------------------------------------------------------------
// DB 엔티티 인터페이스
// ---------------------------------------------------------------------------

export interface Reservation {
  id: number;
  reservation_code: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  service_type: string;
  region: string;
  address: string;
  area_pyeong: number | null;
  house_type_key: string | null;       // 주택유형 키 (원룸/24평 등)
  price_multiplier: number;            // 파생 상품 승수 (1.0/1.5/1.1)
  house_structure: string | null;
  occupancy_status: OccupancyStatus | null;
  desired_date: string | null;
  time_slot: TimeSlot;
  entry_route: EntryRoute;
  extra_options: string | null; // JSON string
  extra_notes: string | null;
  has_site_photos: number;
  base_price_snapshot: number | null;
  extra_price_snapshot: number | null;
  option_breakdown_snapshot: string | null; // 예약 당시 옵션별 label/price/isConsult JSON snapshot
  deposit_amount_snapshot: number | null;
  instant_discount_snapshot: number | null;
  estimated_total_snapshot: number | null;
  estimated_balance_snapshot: number | null;
  price_confirmed_snapshot: number | null; // 1=확정가, 0=시작가(미확정)
  final_confirmed_total: number | null;    // 관리자 입력 최종 확정금액
  instant_discount_eligible: number;
  instant_discount_applied: number;
  privacy_agreed: number;
  privacy_agreed_at: string | null;
  reservation_status: ReservationStatus;
  admin_memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  reservation_id: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  amount: number;
  depositor_name: string | null;
  payment_due_date: string | null;
  confirmed_at: string | null;
  confirmed_by_admin_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarDay {
  date: string;
  status: CalendarStatus;
  memo: string | null;
  updated_at: string;
}

export interface ConfirmationLog {
  id: number;
  reservation_id: number;
  admin_id: number | null;
  admin_name: string | null;
  action: string;
  detail: string | null;
  prev_status: string | null;
  next_status: string | null;
  created_at: string;
}

export interface Review {
  id: number;
  slug: string;
  service_type: string;
  region: string;
  area_pyeong: number | null;
  content: string;
  before_photo_url: string | null;
  after_photo_url: string | null;
  is_published: number;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: number;
  slug: string;
  title: string;
  content: string;
  cover_image_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  is_published: number;
  created_at: string;
  updated_at: string;
}
