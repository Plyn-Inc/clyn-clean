# Migration Review — 2026-09-14 예약시스템 개편

**Production Supabase 미적용.** 적용 전 이 문서로 영향도를 확인한다.

## 적용 대상 (신규 2개)

기존 migration 9개는 수정하지 않았다 (SHA-256 동결 테스트로 보호).

### 1. `20260914090000_independent_service_pricing.sql`

**DDL**
```
ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS product_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_rules_service_product
  ON price_rules(service_type, product_key) WHERE product_key IS NOT NULL;
```

**Data migration**
- `UPDATE price_rules SET product_key = note WHERE product_key IS NULL`
- 사이청소 = 입주청소 × 1.5, 거주청소 = 입주청소 × 1.1 을 **독립 row로 INSERT**
- 집정리 3패키지 INSERT (1p4h/2p4h/3p4h)
- `settings.holiday_surcharge = '30000'` (ON CONFLICT DO NOTHING)

**예상 row 변화**: price_rules 12 → 39 (+27)

**위험 점검**
| 항목 | 결과 |
|---|---|
| unique index 기존 데이터 충돌 | `note`가 상품별 유일하므로 충돌 없음. 중복 시 index 생성 실패 → 적용 전 `SELECT service_type, note, COUNT(*) FROM price_rules GROUP BY 1,2 HAVING COUNT(*)>1` 확인 필요 |
| product_key NULL row | partial index(`WHERE product_key IS NOT NULL`)로 허용 |
| 중복 INSERT | `NOT EXISTS` 가드로 재실행 안전 |
| 기존 예약 영향 | 없음 (snapshot 컬럼 사용) |

**1.5/1.1은 이 파일에서만 사용한다.** runtime 코드에는 배수 계산이 없다.

### 2. `20260914091000_region_slot_and_snapshot.sql`

**신규 테이블 3개**
- `administrative_areas` (code PK, parent_code 자기참조 FK)
- `service_areas` (sigungu_code PK → administrative_areas FK, updated_by_admin_id → admins FK)
- `calendar_slot_reopen_overrides` (date+time_slot UNIQUE, source_reservation_id → reservations FK)

**컬럼 추가 (전부 IF NOT EXISTS, NULL 허용 또는 DEFAULT)**
- `reservations`: `move_out_time`, `move_in_time`, `area_sido_code`, `area_sigungu_code`, `area_dong_code`, `product_key`, `holiday_surcharge_snapshot`(DEFAULT 0), `total_amount_snapshot`
- `consultation_requests`: 지역 code 3종

**FK 순서**: `administrative_areas` → `service_areas` 순으로 생성되며 `admins`·`reservations`는 기존 테이블이므로 문제없음.

**기존 예약 영향**: 신규 컬럼은 전부 NULL 또는 0 기본값. 기존 row는 레거시 컬럼(`base_price_snapshot` 등)으로 계속 조회된다.

## 적용 순서

```
20260914090000_independent_service_pricing.sql
20260914091000_region_slot_and_snapshot.sql
```

## 적용 후 확인 쿼리

```sql
SELECT service_type, COUNT(*) FROM price_rules WHERE product_key IS NOT NULL GROUP BY 1;
-- 입주청소 12 / 사이청소 12 / 거주청소 12 / 집정리 3

SELECT value FROM settings WHERE key='holiday_surcharge';  -- 30000
SELECT COUNT(*) FROM administrative_areas;                 -- 0 (master 임포트 전)
SELECT COUNT(*) FROM service_areas;                        -- 0
```

## Rollback

DDL은 추가만 하므로 되돌릴 필요가 거의 없다. 필요 시:
```sql
DELETE FROM price_rules WHERE service_type IN ('사이청소','거주청소','집정리') AND product_key IS NOT NULL;
-- 신규 테이블은 DROP TABLE로 제거 (기존 예약 데이터와 무관)
```
컬럼 추가는 남겨두어도 기존 코드에 영향이 없다.

## 행정구역 master

**아직 임포트되지 않았다.** 공식 행정안전부 코드 데이터를 받은 뒤
`scripts/import-administrative-areas.mjs`로 임포트한다. 임포트 전까지
서비스 지역 검증은 적용되지 않으며, 관리자 화면에 안내가 표시된다.
