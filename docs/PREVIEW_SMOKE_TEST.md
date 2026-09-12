# Vercel Preview / Staging Smoke Test 절차

Production 배포 전 실환경에서 확인한다. 회귀 테스트로는 잡히지 않는
실제 네트워크·Supavisor·serverless freeze 동작을 검증하는 목적이다.

## 사전 조건

1. Supabase migration 전부 적용
   ```
   supabase/migrations/  (9개)
   ```
   적용 확인:
   ```sql
   SELECT COUNT(*) FROM special_days;            -- 테이블 존재
   SELECT note, base_price FROM price_rules
    WHERE service_type='입주청소' ORDER BY id;    -- 12행
   SELECT value FROM settings WHERE key='balance_notice';
   ```

2. Vercel 환경변수
   ```
   DATABASE_URL       Transaction Pooler URI (:6543)
   SITE_URL           https://<preview-domain>
   KASI_SERVICE_KEY   공공데이터포털 인증키
   CRON_SECRET        임의 랜덤 문자열
   JWT_SECRET
   ```

3. KASI 동기화 1회 실행
   ```
   관리자 → 공휴일 관리 → 동기화 실행
   또는 curl -H "Authorization: Bearer $CRON_SECRET" <preview>/api/cron/special-days
   ```
   커버리지가 "정상"인지 확인한다.

## A. 성능 (acceptance 기준)

| 항목 | 기준 |
|---|---|
| 홈페이지 first response | 수분 대기 0건 |
| DB 장애 시 홈 shell | 수초 내 표시 |
| warm request | 수초 이내 |
| DB timeout 발생 시 | 15초 이상 전체 페이지 blocking 없음 |

측정:
```bash
# cold (첫 요청)
curl -o /dev/null -s -w 'TTFB %{time_starttransfer}s / total %{time_total}s\n' <preview>/

# warm (연속 5회)
for i in $(seq 5); do
  curl -o /dev/null -s -w '%{time_starttransfer}\n' <preview>/
done
```

## B. orphan query 확인

홈페이지를 20회 연속 새로고침한 뒤 Supabase SQL Editor에서:

```sql
SELECT pid, state, wait_event_type, wait_event,
       now() - query_start AS query_age,
       left(query, 60) AS q
  FROM pg_stat_activity
 WHERE application_name = 'Supavisor'
   AND state <> 'idle'
 ORDER BY query_start;
```

확인 사항:
- `query_age`가 30초 이상인 행이 없을 것
- `ClientRead` 상태로 누적되는 행이 없을 것
- 새로고침을 반복해도 행 수가 계속 증가하지 않을 것

## C. 의도적 지연 시 동작

Supabase SQL Editor에서 긴 락을 만들고 홈을 호출해, 앱이 8초 timeout 후
`[db] query:timeout` 로그를 남기고 페이지가 응답하는지 확인한다.
이후 B의 쿼리로 orphan이 남지 않았는지 다시 본다.

## D. DB 장애 시 shell

`DATABASE_URL`을 일시적으로 잘못된 값으로 바꾼 Preview 배포에서:
- 홈페이지가 200으로 응답하고 브랜드(CLYN CLEAN CARE)·Hero·사진이 보일 것
- 후기/블로그 섹션은 비어 있을 것 (500 아님)
- 캘린더는 "예약 일정을 불러오지 못했습니다" + 다시 불러오기 버튼

## E. Runtime Log 확인

Vercel → Logs에서:
```
[db] query:slow <op> <ms>ms
[db] query:timeout <op> 8000ms
[db] client:recycle stale-connection
```
SQL 본문·파라미터·고객정보·DATABASE_URL이 로그에 없어야 한다.

## F. 기능 smoke

1. 홈 → 캘린더 날짜 선택 → 예약 6단계 → 계좌 확인
2. 40평 이상 선택 → 상담 전환 확인
3. 반려동물 "있었음" → 상담 전환 확인
4. `/consultation` 직접 접수
5. 관리자 로그인 → 예약/상담/공휴일 관리
6. PC·모바일 실화면 (사진 20장, BI, 가격 섹션 부재)
