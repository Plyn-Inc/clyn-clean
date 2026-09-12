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
  | "approved_awaiting_deposit"
  | "awaiting_deposit"
  | "awaiting_admin_check"
  | "confirmed"
  | "consult_required"
  | "cancelled"
  | "completed";

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  received: "예약 신청 접수 / 검토 중",
  approved_awaiting_deposit: "예약 승인 / 예약금 입금 대기",
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
  "1.5룸",
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
  // --- 최소 고객정보: 작업지역 (행정구역 동 기준) ---
  area_sido: string | null;
  area_sigungu: string | null;
  area_dong: string | null;
  // --- 서비스 동의 3종 (개별 저장) ---
  core_principles_agreed: number;
  service_terms_agreed: number;
  additional_charge_agreed: number;
  agreement_version: string | null;
  agreed_at: string | null;
  // --- 예약금 계좌 안내 / 입금기한 만료 추적 ---
  account_revealed_at: string | null;
  deposit_expired_at: string | null;
  auto_released: number;
  /** 반려동물 있음 (1) — 상담 전환 판정. JSON 파싱이 아닌 정식 컬럼 */
  has_pet: number;
  /** 날짜 조건 가격 보정 내부 감사용 (고객 미노출) */
  date_adjustment_applied: number;
  date_adjustment_amount: number;
  // --- 레거시(현 흐름 미사용, 스키마 호환 유지) ---
  approved_at: string | null;
  approved_by_admin_id: number | null;
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

// ---------------------------------------------------------------------------
// 평형별 예약 선금 (확정 기준)
//
// 예약 선금은 총 청소금액에 "포함"되는 금액이며 추가 비용이 아니다.
//   총 청소금액 = 예약 선금 + 현장 잔금
//
// 실제 적용 값은 price_rules.deposit_amount(관리자 수정 가능)를 우선하며,
// 이 상수는 최초 seed 및 fallback 기준값이다.
// ---------------------------------------------------------------------------
/**
 * 고객에게 보여줄 서비스 label.
 *
 * 내부 service_type key("사이청소")는 DB/API/price_rules에서 그대로 유지한다.
 * 고객 노출 문자열만 이 맵을 통해 변환한다 (migration 영향 없음).
 */
export const SERVICE_TYPE_LABEL: Record<string, string> = {
  "입주청소": "입주청소",
  "사이청소": "당일 이사 사이청소",
  "거주청소": "거주청소",
  "집정리": "집정리",
};

/** 고객 label 조회 (미등록 key는 원본 그대로) */
export function serviceLabel(serviceType: string): string {
  return SERVICE_TYPE_LABEL[serviceType] ?? serviceType;
}

/** 서비스별 고객 설명 (짧은 버전) */
export const SERVICE_TYPE_SHORT_DESC: Record<string, string> = {
  "사이청소": "퇴거와 새 입주 사이 시간에 진행하는 당일 청소",
};

export const DEFAULT_DEPOSIT_BY_HOUSE_TYPE: Record<string, number> = {
  "원룸": 60000,
  "원룸 복층": 60000,
  "1.5룸": 60000,
  "투룸": 60000,
  "쓰리룸": 60000,
  "18평": 60000,
  "24평": 60000,
  "28평": 70000,
  "32평": 70000,
  "34평": 70000,
  "38평": 80000,
  "40평": 90000,
};


// ---------------------------------------------------------------------------
// 확정 기본 청소금액 (부가세 포함 고객 표시금액)
//
// 이 상수는 price_rules seed 및 fallback의 single source of truth이다.
// 실제 적용 금액은 price_rules.base_price(관리자 수정 가능)를 우선한다.
// 홈페이지/견적 어디에서도 VAT를 자동 가산하지 않는다.
// ---------------------------------------------------------------------------
export const DEFAULT_BASE_PRICE_BY_HOUSE_TYPE: Record<string, number> = {
  "원룸": 179000,
  "원룸 복층": 239000,
  "1.5룸": 249000,
  "투룸": 269000,
  "쓰리룸": 319000,
  "18평": 329000,
  "24평": 369000,
  "28평": 420000,
  "32평": 459000,
  "34평": 489000,
  "38평": 539000,
  // 40평 이상은 확정 자동견적 상품이 아니다. 상담 참고 시작가.
  "40평": 579000,
};

/**
 * 고객 표시 금액 안내 문구.
 * 고객에게 표시되는 모든 금액은 부가세가 포함된 최종 표시금액이다.
 * "VAT 별도" / "부가세 별도" 문구는 고객 UI에 사용하지 않는다.
 */
export const VAT_NOTICE = "※ 표시 금액은 부가세가 포함된 금액입니다.";

/** 추가 서비스 공통 안내 문구 */
export const EXTRA_SERVICE_NOTICE =
  "※ 추가 서비스는 현장 상태와 작업 범위를 확인한 후 추가 비용이 발생할 수 있으며, 비용은 작업 전 고객 확인 및 동의 후 확정됩니다.";

/** 날짜 조건 내부 가격 보정액 (고객에게 사유/금액을 노출하지 않는다) */
export const DATE_ADJUSTMENT_AMOUNT = 30000;

/** 40평 이상 상담 전환 안내 */
export const SIZE_40_PLUS_CONSULT_NOTICE =
  "40평 이상은 별도 확인이 필요한 서비스입니다. 상담 접수 후 담당자가 확인하여 영업일 기준 24시간 이내 연락드립니다.";

/** 반려동물 상담 전환 안내 */
export const PET_CONSULT_NOTICE =
  "반려동물 관련 추가 확인이 필요합니다. 담당자가 확인 후 영업일 기준 24시간 이내 연락드리겠습니다.";

/**
 * 상품별 표준 주거 구조 기준.
 * 이 구조를 초과하는 범위는 현장 확인 후 고객 동의를 받아 추가 작업으로 진행한다.
 */
export const HOUSE_TYPE_STRUCTURE: Record<string, string> = {
  "원룸": "한 공간의 방/주방, 욕실 1",
  "원룸 복층": "2층 공간, 1층 주방·욕실·생활공간",
  "1.5룸": "방 1, 주방 1, 욕실 1",
  "투룸": "방 2, 욕실 1",
  "쓰리룸": "방 3, 욕실 1, 다용도실 1",
  "18평": "방 2, 거실 1, 욕실 1, 주방 1",
  "24평": "방 3, 욕실 1, 거실 1, 주방 1, 다용도실",
  "28평": "방 3, 욕실 2, 거실 1, 주방 1, 다용도실",
  "32평": "방 3, 욕실 2, 거실 1, 주방 1, 다용도실",
  "34평": "방 3, 욕실 2, 거실 1, 주방 1, 다용도실",
  "38평": "방 4, 욕실 2, 거실 1, 주방 1, 다용도실",
  "40평": "방 4, 욕실 2, 거실 1, 주방 1, 다용도실",
};

// ---------------------------------------------------------------------------
// 고객 공개 예약 상태 (요구사항 21~22)
//
// 고객에게는 내부 상태값을 그대로 보여주지 않는다.
// 수량(1건 남음 등)은 절대 표시하지 않는다.
// ---------------------------------------------------------------------------
export type PublicSlotStatus = "예약가능" | "예약진행 중" | "예약완료";

/**
 * 내부 예약상태 → 고객 공개상태 매핑.
 *  - 예약진행 중: 해당 슬롯 고객이 예약금 입금 절차를 진행 중 (타 고객 예약 불가)
 *  - 예약완료:   관리자가 예약금 입금을 실제 확인한 상태
 */
export function toPublicReservationStatus(status: ReservationStatus): PublicSlotStatus {
  switch (status) {
    case "confirmed":
    case "completed":
      return "예약완료";
    case "received":
    case "approved_awaiting_deposit":
    case "awaiting_deposit":
    case "awaiting_admin_check":
      return "예약진행 중";
    default:
      // cancelled / consult_required 등은 슬롯을 점유하지 않는다
      return "예약가능";
  }
}

/**
 * 슬롯 잔여 수량 → 고객 공개상태.
 * remaining 값 자체는 고객에게 노출하지 않는다.
 */
export function toPublicSlotStatus(params: {
  effectiveStatus: string;
  remaining: number;
  hasConfirmed: boolean;
}): PublicSlotStatus {
  if (params.effectiveStatus === "off" || params.effectiveStatus === "consult_required") {
    return "예약완료";
  }
  if (params.remaining > 0) return "예약가능";
  return params.hasConfirmed ? "예약완료" : "예약진행 중";
}


// ---------------------------------------------------------------------------
// 상담접수 (consultation_requests)
//
// 40평 이상 / 반려동물 있음 등 자동예약이 불가한 건을 일반 예약과 분리해 관리한다.
// 상담접수는 캘린더 슬롯을 점유하지 않는다.
// ---------------------------------------------------------------------------
export type ConsultationStatus = "received" | "contacting" | "converted" | "closed";

export const CONSULTATION_STATUS_LABEL: Record<ConsultationStatus, string> = {
  received: "신규 접수",
  contacting: "연락 진행 중",
  converted: "예약 전환 완료",
  closed: "종료",
};

/** 상담 전환 사유 */
export type ConsultationReason = "size_40_plus" | "pet" | "price_unconfirmed" | "manual";

export const CONSULTATION_REASON_LABEL: Record<ConsultationReason, string> = {
  size_40_plus: "40평 이상",
  pet: "반려동물",
  price_unconfirmed: "견적 확인 필요",
  manual: "직접 상담 신청",
};

export interface ConsultationRequest {
  id: number;
  request_code: string;
  customer_name: string;
  customer_phone: string;
  area_sido: string | null;
  area_sigungu: string | null;
  area_dong: string | null;
  address: string | null;
  service_type: string | null;
  house_type_key: string | null;
  actual_pyeong: number | null;
  preferred_date: string | null;
  preferred_time_slot: string | null;
  reason: string;
  /** 반려동물 상세 JSON */
  pet_meta: string | null;
  extra_notes: string | null;
  /** 상담 참고용 시작가. 확정 견적이 아니다 */
  reference_price: number | null;
  status: ConsultationStatus;
  admin_memo: string | null;
  converted_reservation_id: number | null;
  privacy_agreed: number;
  created_at: string;
  updated_at: string;
}

/** 상담 접수 완료 안내 */
export const CONSULTATION_COMPLETE_NOTICE =
  "상담 접수가 완료되었습니다. 담당자가 확인 후 영업일 기준 24시간 이내 연락드리겠습니다.";
