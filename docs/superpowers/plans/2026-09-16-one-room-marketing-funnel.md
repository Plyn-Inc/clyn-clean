# Clyn Clean One-room Marketing Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 CLYN 예약 엔진 위에 일반 원룸 139,000원 프로모션 중심 메인/광고 랜딩, 원룸 간소화 예약, 광고 attribution 저장을 추가한다.

**Architecture:** 기존 `BookingForm`, quote/reservation API, 서비스지역/캘린더를 공유하고 UI 모드만 분기한다. 가격은 서버 offer API에서 기존 `price_rules + discount_promotions`로 계산하고, attribution은 localStorage snapshot을 예약 요청과 함께 저장한다.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.4, TypeScript, Zod 4, PostgreSQL/Supabase + SQLite regression fallback, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-16-one-room-marketing-funnel-design.md`

## Global Constraints

- `/one-room` 온라인 예약 대상은 일반 단층 원룸만이다.
- `원룸 복층`, 1.5룸, 투룸 이상은 광고 랜딩 예약 대상에서 제외한다.
- 기존 일반 예약의 `원룸 복층` 상품은 유지한다.
- 가격은 JSX에 하드코딩하지 않는다.
- 메인 first shell에서 DB를 await하지 않는다.
- 기존 quoteToken/할인/예약금/슬롯 중복방지 계약을 변경하지 않는다.
- marketing event에는 이름/전화번호 등 PII를 저장하지 않는다.

---

### Task 1: 마케팅 UI 계약 테스트

**Files:**
- Create: `tests/one-room-marketing.test.mjs`

**Interfaces:**
- Produces: 메인/랜딩/예약모드/attribution 소스 계약 테스트

- [ ] 실패 테스트 작성: `/one-room`, `mode="one-room"`, OPEN PRICE 컴포넌트, 복층 제외 문구, attribution API/DB 컬럼을 요구한다.
- [ ] `node --test tests/one-room-marketing.test.mjs`로 RED를 확인한다.

### Task 2: OPEN PRICE 공개 offer

**Files:**
- Create: `src/lib/offers.ts`
- Create: `src/app/api/offers/one-room/route.ts`
- Create: `src/components/OneRoomOfferPrice.tsx`

**Interfaces:**
- Produces: `GET /api/offers/one-room` → `{basePrice, openPrice, discountAmount, promotionName}`

- [ ] `getServiceProductPrice("입주청소","원룸")`와 `calculateDiscounts()`를 조합한다.
- [ ] API는 캐시 헤더를 제공하고 상품 비활성/조회실패를 안전하게 반환한다.
- [ ] 클라이언트 가격 컴포넌트는 숫자를 하드코딩하지 않고 API 결과만 표시한다.

### Task 3: 메인/원룸 랜딩 UI

**Files:**
- Modify: `src/components/HeroBanner.tsx`
- Create: `src/components/OneRoomTrustPoints.tsx`
- Create: `src/components/OneRoomScope.tsx`
- Create: `src/components/OneRoomLandingHero.tsx`
- Create: `src/components/MobileStickyCta.tsx`
- Modify: `src/components/SiteHeader.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/one-room/page.tsx`

**Interfaces:**
- Consumes: `OneRoomOfferPrice`, 기존 BeforeAfter/Reviews/BookingSection
- Produces: 메인 원룸 우선 흐름과 광고 전용 랜딩

- [ ] 메인 Hero를 원룸/OPEN PRICE 중심으로 변경한다.
- [ ] 메인 섹션 순서를 원룸 판매 우선으로 재배치한다.
- [ ] `/one-room`에서 일반 원룸 대상/제외조건과 모바일 CTA를 노출한다.
- [ ] SiteHeader는 `/one-room`에서 간소화 모드를 렌더링한다.

### Task 4: 원룸 간소화 예약모드

**Files:**
- Modify: `src/components/booking/BookingSection.tsx`
- Modify: `src/components/booking/BookingForm.tsx`

**Interfaces:**
- Produces: `BookingSection({mode?: "default"|"one-room"})`
- One-room defaults: `serviceType="입주청소"`, `houseTypeKey="원룸"`

- [ ] 원룸 모드에서 서비스/주택유형 선택 UI를 숨긴다.
- [ ] 원룸 모드에서는 입주 상태를 `before_move_in/after_move_out`만 노출한다.
- [ ] 원룸 모드에서는 상품을 `입주청소/원룸`으로 고정하고 별도의 복층·1.5룸 구조 확인 체크나 제출 차단을 추가하지 않는다.
- [ ] 일반 모드의 기존 상품/복층 흐름은 유지한다.

### Task 5: 광고 attribution + 이벤트 저장

**Files:**
- Create: `src/lib/marketing-attribution.ts`
- Create: `src/components/MarketingAttributionCapture.tsx`
- Create: `src/app/api/marketing/events/route.ts`
- Create: `src/database/repositories/marketing-repository.ts`
- Modify: `src/database/schema.ts`
- Create: `supabase/migrations/20260916090000_marketing_attribution.sql`
- Modify: `src/app/api/reservations/route.ts`
- Modify: `src/database/repositories/reservation-repository.ts`
- Modify: `src/lib/reservations.ts`
- Modify: `src/components/booking/BookingForm.tsx`

**Interfaces:**
- Produces: `MarketingAttribution` snapshot and `marketing_events`

- [ ] 최초/최종 유입을 localStorage에 보존한다.
- [ ] `landing_view`, `booking_started`, `kakao_clicked`는 best-effort API 이벤트로 보낸다.
- [ ] 예약 요청에 attribution을 포함하고 reservation 컬럼에 저장한다.
- [ ] 예약 저장 성공 후 서버가 `booking_completed`를 기록한다.

### Task 6: Admin 유입정보 표시

**Files:**
- Modify: 예약 상세 page/component under `src/app/admin/(protected)/reservations/`

**Interfaces:**
- Consumes: reservation attribution columns
- Produces: 최초 유입/캠페인/키워드/랜딩 표시

- [ ] 예약 상세에 유입정보 패널을 추가한다.

### Task 7: GREEN 및 전체 검증

- [ ] `node --test tests/one-room-marketing.test.mjs`
- [ ] 가능한 경우 `npm run test:regression`
- [ ] 가능한 경우 `npm run lint`
- [ ] 가능한 경우 `npx tsc --noEmit`
- [ ] 가능한 경우 `npm run build`
- [ ] 변경본 ZIP을 `/mnt/data`에 생성한다.
