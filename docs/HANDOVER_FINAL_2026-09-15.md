# Clyn Clean 최종 인수인계서 — 2026-09-15

## 1. 검증 결과 (실제 실행)

```
regression              443 / 443 PASS / 0 fail
PostgreSQL integration   23 /  23 PASS / 0 fail / 0 skipped
production E2E           31 /  31 PASS / 0 fail
lint                     exit 0
tsc                      exit 0
build                    exit 0
```

E2E는 실제 PostgreSQL 16 + `next start`(production build)에서 실행했다.

| # | 시나리오 | 결과 |
|---|---|---|
| 1-5 | 지역 선택 → quote → 자동 프로모션 → 쿠폰 → 새 quoteToken | PASS |
| 6-7 | 예약 접수 201 + 계좌 안내 | PASS |
| 8 | 동일 토큰 중복 제출 → 같은 예약 (idempotency) | PASS |
| 9 | quoteToken 변조 거절 400 | PASS |
| 10 | 잘못된 쿠폰 거절 | PASS |
| 11 | Admin 미인증 차단 | PASS |
| 12-17 | Admin 로그인 / dashboard / 예약목록 / 예약상세 / 할인관리 / 공지관리 200 | PASS |
| 18-21 | 입금확인 → 관리자 수동할인 → audit → 메시지 이력 | PASS |
| 28-31 | 예약확정 + outbox 3종 생성 확인 | PASS |
| 22-25 | 공지 작성 → 공개 노출 → 팝업 → /notice | PASS |
| 26-27 | 알림 cron 인증 / 미인증 차단 | PASS |

## 2. Admin Dashboard 500 — 최종 상태

초기 장애였던 `/admin/dashboard`는 production-equivalent 환경에서 **HTTP 200**을 확인했다.

- v17 코드 자체에는 결함이 없었다. **문제는 관측 불가 상태였다** (error.tsx 0건, try/catch 0건).
- `safeStage()`로 통계·최근예약을 위젯 단위 격리했고, DB 완전 중단 시에도 200 + 안내가 표시된다.
- 서버 로그: `[admin-dashboard] stage=... code=... durationMs=... requestId=...`
- **운영 500의 직접 예외 원인은 아직 미확정이다.** 배포 후 위 로그로 확인해야 한다.

## 3. 핵심 아키텍처

### 가격/예약
```
/api/quote          지역·기간·상품·사이청소 시간·공휴일·가격·자동할인·쿠폰 검증
                    → 통과분만 HMAC 서명(quoteToken)
POST /api/reservations
                    이름·연락처·동의 + 토큰 서명/만료/subject 일치
                    + quoteId idempotency + 슬롯 충돌(advisory lock)
                    ※ 가격 재계산 없음
```
`QUOTE_TOKEN_SECRET`으로 서명하며 production 미설정 시 fail closed.

### 할인
```
정상가 → 자동 프로모션(최대 1개) → 쿠폰 → 관리자 수동 할인 → 최종금액
```
쿠폰 redemption은 예약 저장 transaction 안에서 `SELECT ... FOR UPDATE`로 처리한다.
예약 snapshot(`original_amount` ~ `final_amount`)은 가격표·프로모션 변경에 영향받지 않는다.

### 알림
```
BEGIN  business 처리 + outbox INSERT  COMMIT
       ↓ (cron, 5분)
pending → processing → awaiting_delivery ─┬→ delivered
                                          └→ kakao_failed → fallback_submitted → fallback_delivered
```
`event_key` UNIQUE로 중복 생성 차단, `FOR UPDATE SKIP LOCKED`로 중복 발송 차단.
**provider 장애가 예약/입금확인/예약확정을 rollback시키지 않는다.**

## 4. Migration (17개, 순서 유지)

기존 순서를 절대 뒤집지 않는다. 신규 6개:

```
20260914090000_independent_service_pricing.sql
20260914091000_region_slot_and_snapshot.sql
20260915090000_reservation_idempotency.sql
20260915100000_slot_conflict_guard.sql
20260915110000_discount_system.sql
20260915120000_notices.sql
20260915130000_notification_outbox.sql
20260915140000_outbox_delivery_reconcile.sql
```
전부 `IF NOT EXISTS` / NULL 허용 / DEFAULT — 기존 예약 데이터를 깨뜨리지 않는다.

## 5. 환경변수 (정확히 이 이름만 사용)

```
DATABASE_URL                            Supabase Transaction Pooler URI
SITE_URL
JWT_SECRET                              관리자 세션
QUOTE_TOKEN_SECRET                      32바이트 이상. openssl rand -base64 48
                                        미설정 시 견적 토큰 미발급 → 예약 접수 차단
CRON_SECRET                             cron Bearer 인증
KASI_SERVICE_KEY                        공휴일 동기화
ADMIN_DEFAULT_USERNAME / ADMIN_DEFAULT_PASSWORD

SOLAPI_API_KEY
SOLAPI_API_SECRET
SOLAPI_SENDER_NUMBER
SOLAPI_KAKAO_PF_ID
SOLAPI_TEMPLATE_RESERVATION_RECEIVED
SOLAPI_TEMPLATE_DEPOSIT_CONFIRMED
SOLAPI_TEMPLATE_RESERVATION_CONFIRMED
```

## 6. 운영 배포 순서

```
1. DB backup
2. migrations 적용 (파일명 순서대로)
3. migration 확인
   SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';  -- 21
   SELECT indexname FROM pg_indexes WHERE indexname='idx_reservations_quote_id';
   SELECT indexname FROM pg_indexes WHERE indexname='idx_outbox_event_key';
4. Vercel 환경변수 설정
5. application deploy
6. smoke test (docs/PREVIEW_SMOKE_TEST.md)
7. cron 확인 — /api/cron/special-days, /api/cron/notifications
8. 실제 예약 1건 테스트
```

**순서를 바꾸면 안 된다.** 애플리케이션이 먼저 배포되면 신규 컬럼 부재로 예약 저장이 실패한다.

## 7. SOLAPI 실제 연동 절차 — 운영 연동 대기

현재 mock provider로 전체 상태 전이와 UI를 검증했다. 아래는 사용자만 처리 가능하다.

1. SOLAPI 가입 → API Key / Secret 발급
2. **발신번호 사전등록** (통신사 심사)
3. 카카오 비즈니스 채널 개설 → SOLAPI에 연동 → `PF_ID` 발급
4. 알림톡 템플릿 3종 등록 → **카카오 검수 승인** (영업일 며칠 소요)
5. 승인된 템플릿 ID를 환경변수에 등록
6. `/api/cron/notifications` 수동 호출로 실제 발송 확인

### 알림톡 템플릿 문안 (검수 신청용)

**① 예약 접수 완료** (`SOLAPI_TEMPLATE_RESERVATION_RECEIVED`)
```
[Clyn Clean] 예약이 접수되었습니다.

#{고객명}님
예약번호 #{예약번호}
서비스 #{서비스}
청소일 #{청소일} #{시간}

예약금 #{예약금}
#{은행} #{계좌번호}
예금주 #{예금주}

입금 확인 후 관리자가 예약을 확정합니다.
```

**② 입금 확인** (`SOLAPI_TEMPLATE_DEPOSIT_CONFIRMED`)
```
[Clyn Clean] 예약금 입금이 확인되었습니다.

#{고객명}님
예약번호 #{예약번호}

관리자 최종 확인 후 예약이 확정됩니다.
```

**③ 예약 확정** (`SOLAPI_TEMPLATE_RESERVATION_CONFIRMED`)
```
[Clyn Clean] 예약이 확정되었습니다.

#{고객명}님
예약번호 #{예약번호}
서비스 #{서비스}
청소일 #{청소일} #{시간}

작업일에 정확히 방문드리겠습니다.
```

상세주소 등 불필요한 개인정보는 메시지에 포함하지 않는다.

## 8. 미완료 / 확인 필요

| 항목 | 상태 |
|---|---|
| 행정구역 master 데이터 | **미임포트.** 공식 CSV/JSON 전달 시 `scripts/import-administrative-areas.mjs`로 적재 |
| SOLAPI credential | **운영 연동 대기** (위 7번 절차) |
| 운영 Admin 500 직접 원인 | 배포 후 `[admin-dashboard]` 로그로 확인 |
| `docs/POSTGRES_VERIFICATION.md` 2건 | 기존 미검증 항목 유지 |
