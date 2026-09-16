# Regression 실패 분류 — v17 기준

할인 등 신규 기능 구현 **전에** 분류한다. 신규 기능 작업 중 임의로 섞어 수정하지 않는다.

## 경과

| 시점 | 결과 |
|---|---|
| v17 전달본 그대로 | 324 / **0 pass** / 324 fail |
| ts-loader `next/cache` 스텁 추가 후 | 324 / 286 pass / **38 fail** |
| 테스트 헬퍼를 v17 `clientQuote` 계약에 정렬 후 | 324 / 293 pass / **31 fail** |

### 이미 해결된 2건 (실제 버그)

**① `tests/ts-loader.mjs`가 `next/cache`를 해석하지 못함 → 전체 324건 실패**
`revalidateTag`/`unstable_cache`를 쓰는 라우트가 추가됐는데 로더 스텁이 없었다.
`tests/stubs/next-cache.mjs` 추가로 해결. **테스트 인프라 버그.**

**② 예약 API 계약 변경 미반영 (7건)**
v17이 `clientQuote`(견적 snapshot)를 필수로 추가했으나 테스트 헬퍼가 보내지 않았다.
`quoteSnapshotFor()` 헬퍼 추가로 해결. **API 계약 변경(의도됨) — 테스트 정렬.**

---

## 남은 31건 분류

### A. 정책 변경 — v17 단순화 설계에 따라 의도적으로 바뀜 (테스트 교체 대상)

통합 지시서가 명시적으로 채택한 설계다. 테스트를 새 정책 검증으로 바꾼다.

| 테스트 | 구 정책 | v17 정책 | 근거 |
|---|---|---|---|
| 예약 생성 응답에 계좌번호 미포함 | 별도 API로만 노출 | **성공 응답에 계좌 포함** | 지시서 4장 "success response에 bank account 포함" |
| 관리자 입금확인 후 예약완료 | 입금확인 → confirmed | 입금확인 → **awaiting_admin_check** → 관리자 확정 → confirmed | 지시서 2장 예약 상태 흐름 |
| 입금확인/만료 경합 시 confirmed 유지 | 위와 동일 전제 | 동일 (기대 상태만 변경) | 〃 |
| 40평 상담 전환 4건 | 서버가 재판정해 409 | 서버는 `clientQuote` 신뢰, 상담 분기는 화면에서 | 지시서 4장 "가격 재계산하지 않음" |
| 비활성 상품/옵션 직접 예약 차단 3건 | 서버 재검증 | 〃 | 〃 |
| 예약 가능기간 밖 날짜 거부 | 서버 재검증 | 〃 | 〃 |
| 서비스지역/행정구역 차단 3건 | 서버 재검증 | 〃 | 〃 |
| 사이청소 시간 서버 검증 5건 | 서버 필수 검증 | 〃 | 〃 |

> **주의**: 이 항목들은 "검증을 없앤다"는 뜻이 아니다. 검증 위치가 **서버 재계산 → 화면 + 저장 시점 최소 검증**으로 옮겨진 것이다.
> 단, 아래 B에 적은 것처럼 **일부는 서버에 남겨야 안전하다.**

### B. 현재 요구사항과 충돌 — 서버 검증을 복원해야 하는 항목 (실제 위험)

지시서 20장(구 설계서)은 "클라이언트 가격/지역 문자열을 신뢰하지 말 것"을 명시한다.
v17이 `clientQuote`를 그대로 신뢰하면 **가격 조작이 가능하다.**

| 항목 | 위험 | 조치 |
|---|---|---|
| `clientQuote.estimatedTotal`을 검증 없이 저장 | 고객이 total=1000으로 조작 가능 | **서버가 price_rules와 대조해 허용 오차 밖이면 거부** |
| 작업지역(`areaSido` 등) `.default("")` | 지역 없이 예약 가능 | 필수 복원 |
| 예약금 > 총액 방어 소실 | 잔금 음수 | 저장 시점 검증 복원 |

이 3건은 **정책 변경이 아니라 회귀**로 판단한다. 할인 구현 시 가격 신뢰 문제가 더 커지므로 **할인 착수 전에 먼저 복원한다.**

### C. Obsolete — 구현 위치가 바뀌어 검사 대상이 사라진 것 (검사 대상 갱신)

| 테스트 | 사유 |
|---|---|
| 캘린더 DB 캐시 단일 source | v17이 캘린더 구현을 재작성 — 새 파일 기준으로 검사식 갱신 |
| 월간 캘린더 N+1 | 〃 |
| 특수일 캐시 없어도 슬롯 열림 | 〃 |
| 마감 슬롯 예약완료 표시 | 〃 |
| BookingForm CONSULT_REQUIRED | v17 BookingForm 재작성 |
| privacyAgreed 하드코딩 금지 | 〃 |
| 관리자 서비스지역 임포트 안내 문구 | v17이 문구 변경 |
| 상담 필수정보 2건 | v17 상담 API 문구 변경 |

---

## 목표

**전체 regression 0 fail.** baseline 31건을 허용치로 두지 않는다.

순서:
1. **B(3건) 서버 검증 복원** — 할인 착수 전 (가격 신뢰 문제라 선행 필수)
2. C(8건) 검사식 갱신
3. A(20건) 새 정책 검증으로 교체

---

# 31건 최종 분류 및 처리 결정 (2026-09-15)

v17이 예약 API의 **서버 측 재검증을 대부분 제거**했다(통합 지시서 4장 "불필요한 DB 왕복 금지" 반영).
그 자체는 승인된 방향이지만, **삭제되면 안 되는 검증까지 함께 사라졌다.** 아래에서 구분한다.

## B. 실제 코드 버그 — 코드를 수정한다 (18건)

확정 요구사항이 명시적으로 서버 검증을 요구한 항목이다. 테스트를 고치지 않는다.

| # | 테스트 | 근거 |
|---|---|---|
| 4 | 사이청소 퇴거/입주 시간 필수 검증 | 통합 지시서 "서버 동일 검증" |
| 5 | 입주 < 퇴거 거부 | 〃 `move_in_time > move_out_time` |
| 8 | 퇴거/입주가 예약일과 같은 날 | 〃 |
| 6 | 사이청소는 오전/오후로 접수 불가 | 사이청소 = `all_day` 확정 |
| 7 | 일반청소는 all_day로 접수 불가 | 일반 서비스 오전/오후 유지 확정 |
| 12 | 기존 예약 있는 날짜 사이청소 차단 | "중복예약은 서버에서 반드시 재검증" |
| 9 | 자기 슬롯 점유로 확정이 막히지 않음 | 접수/확정 분리 |
| 14 | 입금확인 vs 만료 경합 | 상태 안전성 |
| 18 | 입금확인 전 예약진행중 / 후 예약완료 | 접수와 관리자 확정 분리 |
| 15 | 예약금 > 총액 거부 | 잔금 음수 방지 |
| 16 | 작업지역 필수 (`areaDong` 포함) | 지역 없이 접수 불가 |
| 2 | 행정구역 master 미임포트 시 직접예약 차단 | **B안 fail-closed 확정** |
| 30 | 활성 지역만 직접 예약 | 〃 |
| 21 | 예약 가능기간 밖 날짜 거부 | booking window 365일 |
| 26 | 상담접수도 기간 검증 | 〃 |
| 24 | 캘린더 공휴일 판정 DB 캐시 단일 source | 캘린더 확정 정책 |
| 25 | 특수일 캐시 없어도 슬롯 안 닫음 | special_days 장애 내성 |
| 27 | 실제 마감 슬롯만 예약완료 | 캘린더 3상태 |
| 28 | 월간 캘린더 N+1 금지 | 성능 확정 요구 |

> 이 중 **16(작업지역)** 은 이번 작업에서 `areaSido`/`areaSigungu` 필수를 이미 복원했다.
> `areaDong`은 세종시처럼 시/군/구가 없는 구조를 고려해 별도 판단이 필요하다.

## A. 정책 변경 — 요구사항 대조 후 테스트를 수정한다 (7건)

| # | 테스트 | 변경 근거 |
|---|---|---|
| 17 | 예약 응답에 계좌번호 미포함 | 통합 지시서 4장 **"success response에 bank account 포함"** — 고객이 즉시 계좌를 봐야 함 |
| 1, 19 | 40평 상담 전환을 예약 API가 재판정 | quoteToken이 `priceConfirmed`를 서명으로 보장. 40평은 `/api/quote`에서 토큰 미발급 → 애초에 제출 불가 |
| 3, 13 | 기준가 미확정 차단 | 〃 |
| 10, 11 | 비활성 상품/옵션 재판정 | 〃 (quote 단계에서 차단) |

> 근거: 예약 제출 경로에서 가격을 재계산하지 않는 것이 승인된 설계다.
> **단, 이는 "검증을 없앤다"가 아니라 "검증 시점을 quote 발급 시점으로 옮긴다"는 뜻이다.**
> quoteToken 서명이 그 시점의 판정을 위조 불가능하게 고정한다.

## C. Obsolete — 제거/갱신 사유를 기록하고 정리한다 (5건)

| # | 테스트 | 사유 |
|---|---|---|
| 20 | `privacyAgreed` 하드코딩 금지 | v17이 BookingForm을 재작성 — 검사 대상 코드가 사라짐. **새 파일 기준으로 검사식 갱신**(삭제 아님, 위험은 계속 방어) |
| 29 | BookingForm CONSULT_REQUIRED 흐름 | 〃 |
| 22, 23 | 상담 필수정보 오류 문구 | v17이 문구 변경 — 문구가 아니라 **거부 여부**로 검사식 갱신 |
| 31 | 관리자 서비스지역 임포트 안내 문구 | 〃 |

## 진행 상태

- 분류 완료 (이 문서)
- B 18건: **미처리** — 서버 검증 복원 필요
- A 7건 / C 5건: **미처리**

**0 fail 달성 전에는 할인 기능에 착수하지 않는다.**

---

# 재분류 (2026-09-15, 2차) — 책임 경계 확정 후

## 확정된 책임 경계

```
/api/quote (견적 발급)
  서비스 가능지역 · 예약 가능기간 · 상품 활성 여부 · 면적/상품 정책
  사이청소 시간 규칙 · 공휴일/특수일 · 가격 계산 · 자동할인 · 쿠폰
  depositAmount <= estimatedTotal, estimatedBalance 정합성
  → 통과 결과를 quoteToken subject에 서명

POST /api/reservations (예약 제출)
  customerName · customerPhone · 필수 동의
  quoteToken HMAC/만료/subject 일치
  quoteId idempotency
  mutable slot conflict 최소 방어
  atomic save
  ※ 가격 DB 재조회 없음, 상태 머신 없음
```

**상태 전이 검증은 Admin reservation-status 계층에서 처리한다.**
`POST /api/reservations`에 상태 머신을 넣지 않는다.

## B 18건 세분화 결과

### B1 — `/api/quote`에서 복원할 검증 (9건)

예약 제출이 아니라 **견적 발급 시점**에 검증하고 토큰에 고정한다.

| # | 항목 |
|---|---|
| 2, 30 | 서비스 가능지역 (master 미임포트 = fail closed, 활성 지역만) |
| 21, 26 | 예약 가능기간 (365일) |
| 4, 5, 8 | 사이청소 시간 규칙 (필수 / 입주>퇴거 / 같은 날) |
| 15 | `depositAmount <= estimatedTotal`, `estimatedBalance` 정합성 |
| 16 | 작업지역 필수 — 단, **세종시 구조 때문에 `areaDong`은 지역 계층에 따라 판단** |

> 구현: `/api/quote`가 위 항목을 검증하고, 실패 시 토큰을 발급하지 않는다.
> 토큰이 없으면 예약 제출 자체가 불가능하므로 서버 방어가 유지된다.

### B2 — 예약 제출에서 유지할 최소 검증 (3건)

슬롯/수용량은 견적 발급 이후에도 바뀌는 mutable state이므로 **여기서만** 확인한다.
전체 캘린더 재조회나 가격 재계산은 하지 않는다.

| # | 항목 |
|---|---|
| 6, 7 | 사이청소 = `all_day`, 일반청소 = 오전/오후 (요청값 정합성, DB 조회 불필요) |
| 12 | 기존 활성 예약이 있는 날짜의 사이청소 차단 — **슬롯 충돌 최소 방어** |

> 가능하면 DB atomic constraint/transaction으로 보장하고,
> 불가피한 경우에만 저장 직전 lightweight 조회를 한다.

### B3 — 실제로는 policy-change / obsolete (6건) — **B에서 제외**

| # | 재분류 | 사유 |
|---|---|---|
| 9, 14, 18 | **policy-change** | 상태 전이는 Admin 계층 책임. `confirmPayment` → `awaiting_admin_check` → 관리자 확정 → `confirmed`가 확정 흐름. 테스트가 구 흐름(`confirmPayment` → 즉시 `confirmed`)을 기대 |
| 27 | **policy-change** | 캘린더는 3종 그대로 정상. 테스트가 관리자 확정 단계를 거치지 않아 `confirmedCount=0` → `예약진행 중`이 **올바른 결과**. 테스트에 확정 단계를 추가한다 |
| 24, 25, 28 | **obsolete** | v17이 `src/app/api/calendar/route.ts`를 재작성 — 구 구현의 함수명/표현식을 정규식으로 검사하던 테스트. **삭제가 아니라 새 구현 기준으로 검사식을 갱신**해 동일 위험(DB 캐시 단일 source · 특수일 장애 시 슬롯 미차단 · N+1 금지)을 계속 방어한다 |

> **고객 캘린더를 4종으로 복원하지 않는다.** `toPublicSlotStatus()`는 이미 3종만 반환하며 이 구조를 유지한다.

## 최종 분류 집계

| 분류 | 건수 |
|---|---|
| B1 — quote 단계 검증 복원 (코드 수정) | 9 |
| B2 — 예약 제출 최소 검증 (코드 수정) | 3 |
| A — policy-change (근거 기록 후 테스트 수정) | 11 |
| C — obsolete (사유 기록 후 검사식 갱신) | 8 |
| **합계** | **31** |

## 다음 작업 순서

1. B1 9건 — `/api/quote` 검증 복원 + quoteToken subject 확장
2. B2 3건 — 예약 제출 슬롯 충돌 최소 방어
3. A 11건 — 테스트를 현재 확정 정책으로 수정
4. C 8건 — 새 구현 기준 검사식 갱신
5. **0 fail 확인 후** 할인 기능 착수

---

# special day capacity override — 조사 결과 (2026-09-15)

## 결론: **존재하지 않는다. 새로 만들지 않는다.**

근거:

| 확인 항목 | 결과 |
|---|---|
| `special_days` 테이블 컬럼 | `date` / `is_holiday` / `holiday_name` / `is_son_eomneun_day` / `source` / `admin_note` / `synced_at` / `updated_at` — **capacity 컬럼 없음** |
| `special-days-store.ts`, `special-days.ts`의 capacity 참조 | **0건** |
| special day → `calendar_days` 동기화 코드 | **없음** |
| `setCalendarDay()` 호출처 | `src/app/api/admin/calendar/route.ts` 한 곳뿐 (관리자 수동 입력) |

## 책임 분리 (확정)

```
special_days   →  공휴일/손없는날 판정만 제공
                  가격/할증은 /api/quote 책임 (holidaySurcharge)
                  capacity에 관여하지 않는다

calendar_days  →  capacity의 유일한 source
                  관리자가 /admin/calendar에서 직접 설정
                  없으면 settings.default_daily_capacity
```

공휴일이라고 자동으로 수용량이 줄지 않는다. 필요하면 **관리자가 해당 날짜의
`calendar_days.capacity`를 직접 조정**한다. 이것이 기존 정책이며 유지한다.

따라서 "special day capacity override 테스트"는 추가하지 않는다.
검증할 동작이 존재하지 않는 테스트를 만들면 없는 정책을 코드로 굳히게 된다.

---

# 통합 실패 2건 — 원인 확정 및 수정 (2026-09-15)

테스트를 약화시키지 않았다. **둘 다 실제 코드 버그였다.**

## ① disabled 지역 quote 차단 → 400 (기대 409)

**추적**
```
countAreas() = 2                       (master 존재)
isServiceArea('TX99') = false          (disabled 정상 판정)
POST /api/quote → 400 "Invalid input: expected string, received null"
```

**원인**: `areaDongCode: z.string().optional()`이 `null`을 형식 오류로 거부해
**지역 검증 branch에 도달조차 못 했다.** 코드가 disabled를 통과시킨 게 아니다.

세종특별자치시처럼 시/군/구 단계가 없는 구조에서는 `sigungu`/`dong`이 `null`로
올라올 수 있으므로 `.nullish()`가 맞다.

**수정**: `src/app/api/quote/route.ts` — 지역 코드 3종을 `.nullish()`로 변경
**검증 후**: `409 OUT_OF_SERVICE_AREA` 정상 반환

`SERVICE_AREA_NOT_READY`(master 자체 없음)와 `OUT_OF_SERVICE_AREA`(master 있으나 disabled)는
서로 다른 branch이며 혼동되지 않는다.

## ② 슬롯 마감 후 SLOT_UNAVAILABLE → 500 (기대 409)

**추적**
```
[slot-debug] ['SlotConflictError:SLOT_UNAVAILABLE:선택하신 날짜에 이미 예약이 있습니다.']
→ outer catch가 ReservationPersistenceError("transaction")으로 재포장
→ route가 RESERVATION_SAVE_FAILED 500 반환
```

**원인 2개**
1. `createReservationAndDeposit()`의 outer catch가 `SlotConflictError`까지 감쌌다.
   슬롯 충돌은 저장 실패가 아니라 **"이미 마감됨"이라는 정상 비즈니스 결과**다.
2. route의 `SLOT_UNAVAILABLE` 분기가 **quoteToken 검증 catch**에 붙어 있어
   저장 단계에서 올라온 오류를 받지 못했다.

**수정**
- `src/lib/reservations.ts` — `SlotConflictError`는 감싸지 않고 그대로 재전파
- `src/app/api/reservations/route.ts` — 슬롯 분기를 저장 단계 catch로 이동

**검증 후**: `409 SLOT_UNAVAILABLE`, `QUOTE_EXPIRED`/`QUOTE_MISMATCH`/500으로 바뀌지 않음

## 책임 경계 (문서화)

```
quoteToken        가격/정책 snapshot — 발급 시점에 고정, 서명으로 위조 불가
슬롯 availability  mutable state — 예약 제출 직전에 다시 확인

따라서: valid quoteToken ≠ 슬롯이 반드시 남아 있다는 보장
```

토큰이 유효해도 슬롯이 마감됐으면 `SLOT_UNAVAILABLE`이며, 이것은 토큰 오류가 아니다.

---

# suite별 결과 분리 (2026-09-15)

새 테스트 추가로 기존 회귀 숫자가 흔들리지 않도록 그룹을 분리해 기록한다.

| suite | 결과 |
|---|---|
| **legacy regression** (v14 lineage 계약 테스트) | **30 fail** — triage 대상 |
| **new quote/idempotency/capacity suite** | **0 fail** (quoteToken 15, idempotency 8+6, 전체 연결 5) |
| **PG integration** (`test:pg`) | **0 fail / 0 skipped** |
