# PostgreSQL 최종 검수 항목

로컬 회귀테스트는 SQLite로 실행되므로, 아래 두 항목은 실제 Supabase PostgreSQL
integration 환경에서 반드시 별도 확인해야 한다.

## 1. executeReturningCount()의 영향 행 수 정확성

`src/database/connection.ts`의 `executeReturningCount()`는 PostgreSQL 경로에서
postgres.js 결과 객체의 `count` 속성을 영향 행 수로 사용한다.

```ts
const result = await client.unsafe(toPostgresSql(sql), params);
return Number((result as unknown as { count?: number }).count ?? 0);
```

확인 필요:
- UPDATE가 0건일 때 실제로 0을 반환하는가
- UPDATE가 1건일 때 실제로 1을 반환하는가
- 트랜잭션(client.begin) 내부에서도 동일하게 동작하는가

이 값이 부정확하면 `compareAndSetReservationStatus()`의 동시성 방어가 무력화된다.

## 2. confirm vs expire 경합 테스트 PostgreSQL 실행

`tests/regression.test.mjs`의 다음 테스트는 SQLite 기준으로 통과했다.

- `동시 경합에서 confirmed가 cancelled로 덮어써지지 않는다 (조건부 atomic update)`
- `조건부 상태 전이는 예상 상태가 아니면 0건을 반환한다 (PostgreSQL row lock 동등 보장)`
- `만료 처리 후 뒤늦은 confirmPayment는 거부된다 (상태 덮어쓰기 차단)`

SQLite는 `BEGIN IMMEDIATE`로 직렬화되므로, PostgreSQL의 행 수준 배타 잠금이
실제로 동일한 보호를 제공하는지 DATABASE_URL을 지정한 환경에서 재확인해야 한다.

특히 두 세션이 실제로 동시에 트랜잭션을 열었을 때,
`UPDATE ... WHERE reservation_status IN (...)`가 한쪽만 1을 반환하는지 확인한다.
