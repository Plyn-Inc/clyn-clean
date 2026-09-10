/**
 * 홈페이지 이미지 자산 메타데이터 — single source of truth.
 *
 * 실제 Clyn Clean 현장 사진만 사용한다 (스톡 이미지 없음).
 * 원본은 EXIF auto-orient 및 메타데이터 제거 후 WebP로 최적화된 상태다.
 * alt는 SEO 키워드 나열이 아니라 실제 장면을 설명한다.
 */

export interface CleanImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface BeforeAfterPair {
  id: string;
  title: string;
  before: CleanImage;
  after: CleanImage;
}

// ---------------------------------------------------------------------------
// Hero — 첫 화면은 완성된 깨끗함만 노출한다 (before 이미지 사용 금지)
// ---------------------------------------------------------------------------
export const HERO_IMAGE: CleanImage = {
  src: "/images/clean/hero/hero-living-room.webp",
  alt: "입주청소가 완료된 밝고 깨끗한 거실",
  width: 1672,
  height: 941,
};

/** 최종 예약 CTA 직전 보조 비주얼 (Hero와 다른 공간) */
export const CTA_IMAGE: CleanImage = {
  src: "/images/clean/hero/hero-kitchen.webp",
  alt: "입주청소가 완료된 깨끗한 주방",
  width: 1672,
  height: 941,
};

// ---------------------------------------------------------------------------
// Before / After — 실제 작업 사례 (구도가 다른 쌍은 카드형 2분할로 표시)
// ---------------------------------------------------------------------------
export const BEFORE_AFTER_PAIRS: BeforeAfterPair[] = [
  {
    id: "window-track",
    title: "창틀 레일",
    before: {
      src: "/images/clean/before-after/window-track-before.webp",
      alt: "청소 전 창틀 레일의 먼지와 오염",
      width: 1200,
      height: 1600,
    },
    after: {
      src: "/images/clean/before-after/window-track-after.webp",
      alt: "청소 후 깨끗해진 창틀 레일",
      width: 1200,
      height: 1600,
    },
  },
  {
    id: "bathroom-01",
    title: "욕실 전체",
    before: {
      src: "/images/clean/before-after/bathroom-01-before.webp",
      alt: "청소 전 욕실 바닥과 변기 주변",
      width: 1200,
      height: 1600,
    },
    after: {
      src: "/images/clean/before-after/bathroom-01-after.webp",
      alt: "청소 후 깨끗해진 욕실 전체",
      width: 1200,
      height: 1600,
    },
  },
  {
    id: "hood-grease",
    title: "주방 후드 내부",
    before: {
      src: "/images/clean/before-after/hood-grease-before.webp",
      alt: "청소 전 주방 후드 내부 기름때",
      width: 1600,
      height: 1200,
    },
    after: {
      src: "/images/clean/before-after/hood-grease-after.webp",
      alt: "청소 후 깨끗해진 주방 후드 내부",
      width: 1600,
      height: 1200,
    },
  },
  {
    id: "storage",
    title: "수납장 내부",
    before: {
      src: "/images/clean/before-after/storage-before.webp",
      alt: "청소 전 수납장 내부 얼룩",
      width: 1200,
      height: 1600,
    },
    after: {
      src: "/images/clean/before-after/storage-after.webp",
      alt: "청소 후 깨끗해진 수납장 내부",
      width: 1200,
      height: 1600,
    },
  },
];

// ---------------------------------------------------------------------------
// 공간별 작업 사례 — After 컷만 사용한다
// ---------------------------------------------------------------------------
export interface PortfolioItem {
  category: string;
  image: CleanImage;
}

export const PORTFOLIO_ITEMS: PortfolioItem[] = [
  {
    category: "거실",
    image: {
      src: "/images/clean/gallery/living-01.webp",
      alt: "입주청소 후 깨끗한 빈 거실",
      width: 1200,
      height: 1600,
    },
  },
  {
    category: "주방",
    image: {
      src: "/images/clean/gallery/kitchen-01.webp",
      alt: "입주청소 후 수납장 내부까지 열린 주방",
      width: 1200,
      height: 1600,
    },
  },
  {
    category: "욕실",
    image: {
      src: "/images/clean/gallery/bathroom-01.webp",
      alt: "입주청소 후 깨끗하게 정리된 욕실",
      width: 1200,
      height: 1600,
    },
  },
  {
    category: "현관",
    image: {
      src: "/images/clean/gallery/entrance-01.webp",
      alt: "입주청소 후 깨끗하게 정리된 현관과 복도",
      width: 1200,
      height: 1600,
    },
  },
];

// ---------------------------------------------------------------------------
// 디테일 사례 — "보이는 곳만 닦지 않습니다"
//
// 서비스 포함 범위를 과장하지 않는다. 실제 작업 사례임을 명시한다.
// ---------------------------------------------------------------------------
export interface DetailCase {
  title: string;
  description: string;
  image: CleanImage;
}

export const DETAIL_CASES: DetailCase[] = [
  {
    title: "배수구 분해 청소",
    description: "배수구를 분해해 내부까지 확인합니다.",
    image: {
      src: "/images/clean/detail/bathroom-detail-drain.webp",
      alt: "분해 청소 후 깨끗한 욕실 배수구",
      width: 1050,
      height: 1400,
    },
  },
  {
    title: "천장 설비 확인",
    description: "욕실 천장 환기 설비까지 상태를 확인합니다.",
    image: {
      src: "/images/clean/detail/bathroom-detail-ceiling.webp",
      alt: "욕실 천장 설비까지 확인하는 디테일 청소",
      width: 1050,
      height: 1400,
    },
  },
  {
    title: "세탁기 고무패킹",
    description: "도어 고무패킹 안쪽 오염을 확인하고 작업합니다.",
    image: {
      src: "/images/clean/before-after/washer-gasket-after.webp",
      alt: "청소 후 깨끗해진 세탁기 고무패킹 내부",
      width: 1200,
      height: 1600,
    },
  },
];

/** 작업 범위 오해를 막기 위한 공통 보조 문구 */
export const CASE_DISCLAIMER =
  "실제 작업 사례입니다. 현장 상태와 계약 범위에 따라 작업 범위가 달라질 수 있습니다.";
