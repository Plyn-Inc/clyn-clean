# Clyn Clean 4-Step Booking Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6단계 고객 예약을 4단계로 축소하고 사이청소를 날짜+퇴거/입주 시간 기반 all_day 예약으로 전환하며, 4단계 완료 직후 서비스별 예약 선금 계좌까지 안정적으로 안내한다.

**Architecture:** `BookingForm`에서 단계/UI 상태를 4단계로 통합하고, API/도메인 계층에서 사이청소 `all_day`를 정식 입력으로 허용한다. 예약 생성은 날짜 공통 lock + 서비스별 슬롯 검증을 사용하고, 금액 snapshot은 `calculateQuote()` 결과를 예약 생성 시 고정한다.

**Tech Stack:** Next.js 16.2.9, React 19.2.4, TypeScript, Zod 4, PostgreSQL/Supabase, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-15-four-step-booking-flow-design.md`

## Global Constraints

- 고객 예약 진행표시는 `서비스 / 날짜 / 고객정보 / 확인·동의` 4단계만 사용한다.
- 사이청소 고객 UI에는 오전/오후 선택을 표시하지 않는다.
- 사이청소 신규 예약은 `time_slot = all_day`로 저장한다.
- 사이청소 접수 직후 오전/오후를 모두 보호하고 관리자 수동 reopen 정책을 유지한다.
- 추가서비스 자동견적과 반려동물 별도 입력은 다시 추가하지 않는다.
- 행정구역 master가 없는 상태의 기존 B안 정책을 변경하지 않는다.
- 서비스별 독립 가격/예약금 snapshot 정책을 유지한다.

---

### Task 1: 사이청소 all_day 입력 계약과 동시성 보호

**Files:**
- Modify: `src/app/api/reservations/route.ts`
- Modify: `src/app/api/quote/route.ts`
- Modify: `src/lib/reservations.ts`
- Test: `tests/regression.test.mjs`

**Interfaces:**
- Consumes: `serviceType`, `desiredDate`, `timeSlot`, `moveOutTime`, `moveInTime`
- Produces: 사이청소용 `timeSlot: "all_day"` API 계약과 양쪽 슬롯 보호

- [ ] **Step 1: 실패 테스트 작성**
  - `createBetweenCleaning()` 테스트 헬퍼의 `timeSlot`을 `all_day`로 바꾼다.
  - 사이청소가 `morning`/`afternoon`을 보내면 400을 반환하는 테스트를 추가한다.
  - 일반 서비스가 `all_day`를 보내면 400을 반환하는 테스트를 추가한다.
  - 같은 날짜 오전 또는 오후가 이미 점유된 경우 사이청소 `all_day` 접수가 실패하는 테스트를 추가한다.

- [ ] **Step 2: RED 확인**
  - Run: `npm run test:regression`
  - Expected: `all_day`가 현재 Zod enum에서 거부되거나 도메인 타입/검증이 실패한다.

- [ ] **Step 3: 최소 구현**
  - 예약 API `timeSlot` enum을 `morning | afternoon | all_day`로 확장한다.
  - 사이청소는 `all_day`만 허용하고, 그 외 서비스는 `all_day`를 거부한다.
  - quote API도 `all_day`를 허용하되 즉시예약 할인 자격은 false로 처리한다.
  - `CreateReservationInput.timeSlot`을 `morning | afternoon | all_day`로 확장한다.
  - `computeInstantDiscountEligible()`은 `all_day`에서 즉시 false를 반환한다.
  - `createReservation()`은 모든 예약에서 먼저 날짜의 `all_day` lock을 잡고, 사이청소는 morning/afternoon lock도 잡은 뒤 양쪽 슬롯이 모두 가용한지 검증한다.

- [ ] **Step 4: GREEN 확인**
  - Run: `npm run test:regression`
  - Expected: 신규 사이청소 계약 테스트와 기존 all_day/reopen 테스트 모두 PASS.

### Task 2: 서비스별 예약 선금 snapshot 고정

**Files:**
- Modify: `src/lib/reservations.ts`
- Test: `tests/regression.test.mjs`

**Interfaces:**
- Consumes: `calculateQuote().depositAmount`, 예약의 `service_type`, `product_key`, `deposit_amount_snapshot`
- Produces: 예약 생성 시 고정된 서비스별 예약 선금 snapshot

- [ ] **Step 1: 실패 테스트 작성**
  - 사이청소 상품의 예약금을 입주청소와 다른 값으로 설정한다.
  - 사이청소 예약 생성 후 가격표를 다시 바꿔도 계좌 공개 금액이 생성 시점 사이청소 예약금 snapshot을 유지하는지 검증한다.

- [ ] **Step 2: RED 확인**
  - Run: `npm run test:regression`
  - Expected: 현재 `revealDepositAccount()`가 입주청소 예약금을 재조회하므로 실패.

- [ ] **Step 3: 최소 구현**
  - `createReservation()`의 첫 quote에서 `q.depositAmount`를 별도 변수에 저장하고 `depositAmountSnapshot`에 기록한다.
  - `revealDepositAccount()`은 저장된 `deposit_amount_snapshot > 0`을 우선 사용한다.
  - 레거시 snapshot이 없을 때만 `getServiceProductPrice(reservation.service_type, reservation.product_key || reservation.house_type_key)`로 보완한다.

- [ ] **Step 4: GREEN 확인**
  - Run: `npm run test:regression`
  - Expected: 서비스별 예약금 snapshot 테스트 PASS.

### Task 3: BookingForm 4단계 UI와 가격 요청 race 제거

**Files:**
- Modify: `src/components/booking/BookingForm.tsx`
- Create: `tests/booking-flow-ui.test.mjs`

**Interfaces:**
- Consumes: `/api/quote`, `/api/reservations`, `/api/reservations/[code]/deposit-account`
- Produces: 4단계 폼, 사이청소 시간 입력, race-safe quote UI

- [ ] **Step 1: 실패 테스트 작성**
  - 소스 계약 테스트로 `STEP_LABELS`가 정확히 4개인지 확인한다.
  - `현장정보` 단계가 없는지 확인한다.
  - 사이청소 분기에서 `timeSlot = "all_day"`를 사용하고 `moveOutTime`/`moveInTime`을 top-level 예약 payload로 보내는지 확인한다.
  - 견적 effect가 `AbortController`를 사용하고 요청 시작 시 loading을 true로 설정하는지 확인한다.

- [ ] **Step 2: RED 확인**
  - Run: `node --test tests/booking-flow-ui.test.mjs`
  - Expected: 현재 6단계/기존 quote fetch 구현 때문에 실패.

- [ ] **Step 3: 최소 구현**
  - `Step`을 `1 | 2 | 3 | 4`, labels를 `서비스/날짜/고객정보/확인·동의`로 변경한다.
  - quote effect를 `AbortController` 기반으로 교체하고 loading/quote 상태를 최신 요청만 갱신하게 한다.
  - 사이청소 선택 시 `timeSlot`을 `all_day`로 정규화한다.
  - 2단계 사이청소는 `type="time"` 두 개만 표시하고, 일반 서비스에만 오전/오후 버튼을 표시한다.
  - 사이청소 시간은 제출 시 `${desiredDate}T${HH:mm}` 형식으로 API에 전달한다.
  - 3단계에 고객정보, 지역, 주소, 이메일, 기타 요청사항, 일반청소 입주상태를 통합한다.
  - 4단계에 요약 + 개인정보 + 서비스 동의를 통합하고, 버튼 클릭 시 예약 생성 → 계좌조회까지 수행한다.

- [ ] **Step 4: GREEN 확인**
  - Run: `node --test tests/booking-flow-ui.test.mjs`
  - Expected: 4단계 UI 계약 PASS.

### Task 4: 사이청소 예약금 결과 화면 시간 표시

**Files:**
- Modify: `src/app/api/reservations/[code]/deposit-account/route.ts`
- Modify: `src/components/booking/DepositAccountPanel.tsx`
- Test: `tests/booking-flow-ui.test.mjs`

**Interfaces:**
- Consumes: reservation `move_out_time`, `move_in_time`, `time_slot`
- Produces: 사이청소 결과 화면의 퇴거/입주 예정시간 표시

- [ ] **Step 1: 실패 테스트 작성**
  - deposit API 응답에 `moveOutTime`, `moveInTime`이 포함되는지 소스 계약을 추가한다.
  - DepositAccountPanel이 `all_day`에서 `-`가 아니라 두 시간을 표시하는지 계약을 추가한다.

- [ ] **Step 2: RED 확인**
  - Run: `node --test tests/booking-flow-ui.test.mjs`
  - Expected: 현재 API/패널에 필드가 없어 실패.

- [ ] **Step 3: 최소 구현**
  - deposit account 응답에 두 시간 컬럼을 추가한다.
  - panel 타입을 확장하고 `all_day`이면 `퇴거 HH:mm ~ 입주 HH:mm` 형식으로 표시한다.

- [ ] **Step 4: GREEN 확인**
  - Run: `node --test tests/booking-flow-ui.test.mjs`
  - Expected: PASS.

### Task 5: 전체 회귀/정적검증/빌드

**Files:**
- Verify only

- [ ] **Step 1: 전체 회귀 테스트**
  - Run: `npm run test:regression`
  - Expected: 0 failures.

- [ ] **Step 2: UI 계약 테스트**
  - Run: `node --test tests/hotfix-calendar-label.test.mjs tests/booking-flow-ui.test.mjs`
  - Expected: 0 failures.

- [ ] **Step 3: Lint**
  - Run: `npm run lint`
  - Expected: 0 errors.

- [ ] **Step 4: TypeScript**
  - Run: `npx tsc --noEmit`
  - Expected: exit 0.

- [ ] **Step 5: Production build**
  - Run: `npm run build`
  - Expected: exit 0.

- [ ] **Step 6: 전달본 생성**
  - 변경 소스 전체 ZIP과 patch를 `/mnt/data`에 생성한다.
