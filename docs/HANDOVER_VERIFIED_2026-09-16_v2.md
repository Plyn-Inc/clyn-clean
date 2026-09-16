# CLYN Clean — v2 정상환경 재검증 결과 (2026-09-16)

## 1. 결론

이전 작업환경에서 npm registry timeout으로 **막혀 있던 전체 검증을 정상 환경에서 모두 실행했고 전부 GREEN**이다.
**소스 코드 수정은 없었다.** 454건 실행 불능은 환경 문제였고 코드 회귀가 아니었음을 확인했다.

## 2. 실제 실행 결과

```
npm ci                                 exit 0
regression                    454 / 454 PASS / 0 fail
one-room-marketing.test.mjs     7 /   7 PASS / 0 fail
PostgreSQL integration         23 /  23 PASS / 0 fail / 0 skipped
production-equivalent E2E      40 /  40 PASS / 0 fail
lint                                   exit 0
tsc --noEmit                           exit 0
build                                  exit 0
```

E2E는 실제 PostgreSQL 16 + `next start`(production build)에서 실행했다.

## 3. 원룸 광고 전환 v2 검증 (E2E 35~40 신규)

| # | 항목 | 결과 |
|---|---|---|
| 35 | 메인 `/` 200 | PASS |
| 36 | `/one-room` 랜딩 200 | PASS |
| 37 | `/one-room`에 복층·1.5룸·투룸 **선택 UI 없음** | PASS |
| 38 | `/api/offers/one-room` OPEN PRICE 조회 | PASS |
| 39 | **OPEN PRICE == 실제 `/api/quote` 결과** | PASS |
| 40 | 일반 예약에 `원룸 복층` 등 기존 상품 유지 | PASS |

### 37번 검증 방식에 대한 기록

`/one-room` HTML에 `원룸 복층` / `1.5룸` / `투룸` 문자열이 나타나지만, 확인 결과 전부
**"대상 제외" 안내 문구**였다(`OneRoomLandingHero`, `OneRoomOfferSection`, `page.tsx`).
선택 UI(`<option>` / `data-product-key`)는 존재하지 않는다.

확정 정책은 "선택시키지 않는다"이므로 이는 **정상**이다.
따라서 검증식을 문자열 존재 여부가 아니라 **선택 UI 부재**로 작성했다.
차단용 체크박스나 추가 API는 만들지 않았다.

### 가격 일치 확인

```
/api/offers/one-room  → { basePrice: 179000, openPrice: 159000,
                          discountAmount: 20000, promotionName: "..." }
/api/quote (입주청소/원룸) → finalAmount 159000
```
로컬 fixture 프로모션(20,000원) 기준으로 두 값이 동일하다.
운영에서 `139,000원`을 표시하려면 **프로모션 할인액을 40,000원으로 설정**하면 된다
(179,000 − 40,000 = 139,000). UI에 상수를 박지 않았으므로 Admin 할인 관리에서 조정 가능하다.

## 4. 광고 추적 검증

```
POST /api/marketing/events  → 201 {"ok":true}
marketing_events 저장 확인   → vis-e2e-0001 | landing_view | google
잘못된 이벤트                → 400 (독립 API이므로 예약에 영향 없음)
```

`marketing_events` 컬럼: `id, reservation_id, visitor_id, event_name, source, medium,
campaign, keyword, landing_page, created_at`
**고객 이름·전화번호 등 PII 컬럼이 없다.**

## 5. 기존 방어 로직 유지 확인

메시지 수동 재시도 중복발송 방어가 그대로 동작한다 (E2E 32~34 PASS).

```
32  awaiting_delivery 수동 재시도 차단 → 409
33  거절 사유 code 반환
34  거절 후 상태 불변
```

예약 idempotency(8), quoteToken 변조 거절(9), 슬롯 충돌, 할인 3종, outbox 3종 모두 PASS.

## 6. Supabase migration 상태

`supabase/migrations/20260916090000_marketing_attribution.sql`은 전부
`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 기반이다.

운영 `clyn-clean`(ref `dayrqharivegljceiydb`)에는 DDL이 이미 적용된 것으로 인수인계됐다.
**재적용하거나 migration history를 조작하지 않았다.** 로컬 PostgreSQL에만 적용해 검증했다.

운영에서 확인이 필요하면 아래를 먼저 조회한다.
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='reservations' AND column_name IN ('visitor_id','first_source','landing_page','first_visit_at');
SELECT relrowsecurity FROM pg_class WHERE relname='marketing_events';
```

## 7. 변경 내역

**소스 코드 변경 없음.** 아래 1개 파일만 검증 범위를 넓혔다.

```
tests/e2e/production-e2e.mjs   E2E 35~40 (원룸 랜딩/가격 일치/기존 상품 유지) 추가
```

## 8. 남은 운영 작업

| 항목 | 상태 |
|---|---|
| Vercel Preview 실제 배포 검수 | **미실행** — 배포 권한 없음. 로컬 production-equivalent로 대체 검증 |
| 운영 프로모션 40,000원 설정 (139,000원 표시) | 운영자 작업 |
| 카카오 채널 승인 / SOLAPI 발신번호 · 템플릿 3종 | 미완료 |
| SOLAPI 환경변수 등록 | 미완료 |
| 실제 알림톡 3종 실발송 + SMS fallback 실검증 | credential 필요 |
| 행정구역 master import | 미임포트 |
| `docs/POSTGRES_VERIFICATION.md` 2건 | 기존 미검증 유지 |
