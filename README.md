# Clyn Clean 입주청소 예약센터

Next.js 16 기반 입주청소 자동견적·예약·관리자 운영 사이트입니다.

## 현재 운영 구조

- **Frontend / Server:** Next.js 16 App Router
- **Production DB:** Supabase PostgreSQL
- **Deployment target:** Vercel
- **Local regression DB:** SQLite (`node:sqlite`)
- **Admin auth:** JWT (`jose`) + HttpOnly Cookie
- **Style:** Tailwind CSS v4 + Pretendard

운영환경에서는 로컬 파일 DB를 사용하지 않습니다. `DATABASE_URL`이 있으면 PostgreSQL을 사용하고, 회귀테스트/로컬 개발에서 `DATABASE_PATH`를 지정하면 SQLite를 사용합니다.

## 설치 및 검증

```bash
npm ci
npm run test:regression
npm run lint
npm run build
```

로컬 개발:

```bash
cp .env.example .env.local
# 로컬 SQLite를 쓰려면 DATABASE_URL을 지우고 아래를 설정
# DATABASE_PATH=.local-data/cleaning-reservation.db
npm run dev
```

## Supabase

현재 운영 스키마는 `supabase/migrations/`에 있습니다.

- `20260908090000_initial_clyn_clean.sql`: 전체 스키마 + 기본 설정/가격/옵션 seed
- `20260908091500_database_hardening.sql`: 가격규칙 중복 방지 + FK 인덱스

앱은 Supabase Data API를 사용하지 않고 **서버에서 PostgreSQL로만 연결**합니다. 업무 테이블은 RLS가 활성화되어 있고 `anon`, `authenticated` 권한은 제거되어 있습니다.

### Vercel용 DB 연결

Supabase Dashboard → **Connect**에서 **Transaction pooler** 연결 문자열을 복사해 Vercel 환경변수 `DATABASE_URL`에 등록합니다. 서버리스에서 prepared statement 충돌을 피하기 위해 앱 DB 드라이버는 `prepare: false`를 사용합니다.

실제 DB 비밀번호나 연결 문자열은 `.env.example`, README, GitHub에 넣지 마세요.

## 필수 환경변수

| 변수 | 설명 | 운영 필수 |
|---|---|---|
| `DATABASE_URL` | Supabase PostgreSQL Transaction pooler URI | ✅ |
| `DATABASE_PATH` | SQLite 경로. 로컬/테스트 전용 | ❌ |
| `ADMIN_DEFAULT_USERNAME` | 최초 관리자 아이디 | ✅ 최초 배포 |
| `ADMIN_DEFAULT_PASSWORD` | 최초 관리자 비밀번호 | ✅ 최초 배포 |
| `ADMIN_DEFAULT_NAME` | 관리자 표시 이름 | 선택 |
| `JWT_SECRET` | 관리자 세션 서명 키, 32자 이상 무작위 | ✅ |
| `SITE_URL` | canonical/sitemap/robots/OG 기준 URL | ✅ |

`JWT_SECRET` 생성 예:

```bash
openssl rand -hex 32
```

## SITE_URL

Vercel 임시 주소로 테스트할 때:

```text
SITE_URL=https://your-project.vercel.app
```

실제 도메인 연결 후:

```text
SITE_URL=https://your-domain.com
```

`SITE_URL` 변경 후에는 Vercel에서 재배포합니다.

## 초기 관리자

1. Vercel 환경변수에 `ADMIN_DEFAULT_USERNAME`, `ADMIN_DEFAULT_PASSWORD`, `ADMIN_DEFAULT_NAME` 설정
2. 첫 실행 시 `admins` 테이블이 비어 있으면 관리자 계정 생성
3. `/admin/login` 접속
4. 최초 로그인 후 비밀번호 변경
5. 이후 필요하면 Vercel에서 초기 비밀번호 환경변수를 제거해도 됩니다.

## 예약 오픈 전 관리자 설정

관리자에서 아래 항목을 반드시 채웁니다.

- 예약금
- 입금 은행명
- 계좌번호
- 예금주
- 입금 기한
- 회사명 / 연락처
- 예약 가능 날짜와 오전/오후 capacity
- 필요 시 가격 및 추가 옵션 ON/OFF

위 계좌/예약금 정보가 준비되지 않으면 공개 예약 API가 예약을 받지 않습니다.

## 백업 / 복구

운영 DB는 Supabase PostgreSQL입니다. 기존 SQLite 파일 복사 방식은 운영 백업 방식이 아닙니다.

운영 백업은 Supabase의 프로젝트 백업/Database Backup 기능 또는 PostgreSQL `pg_dump`를 사용합니다. 복구 전에는 반드시 현재 운영 데이터와 대상 프로젝트를 확인하세요.

로컬 SQLite는 테스트 편의를 위한 어댑터일 뿐이며 운영 데이터의 source of truth가 아닙니다.

## 회귀테스트 범위

`npm run test:regression`은 다음 핵심 규칙을 검증합니다.

- 주택유형 × 서비스 가격 및 승수
- 집정리 패키지 가격
- 40평 이상 미확정 견적/관리자 최종금액
- 추가 옵션 활성화와 snapshot
- capacity 및 입금기한 초과 슬롯 해제
- 입금확인 → 관리자확정 상태전이
- 취소/환불 상태전이
- 서버 입력값 검증
- SITE_URL / robots / 약관
- SQLite/PostgreSQL DB adapter 선택
- PostgreSQL 날짜 및 SQL 문법 호환

## Vercel 배포 순서

1. Supabase migration 적용
2. GitHub 저장소에 코드 push
3. Vercel에서 GitHub 프로젝트 Import
4. Vercel Environment Variables 등록
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `ADMIN_DEFAULT_USERNAME`
   - `ADMIN_DEFAULT_PASSWORD`
   - `ADMIN_DEFAULT_NAME`
   - `SITE_URL`
5. 첫 배포
6. Vercel 임시 URL에서 관리자 로그인 및 설정 입력
7. 실제 예약 E2E 테스트
8. 도메인 연결
9. `SITE_URL`을 실제 도메인으로 변경 후 재배포

## 운영 전 체크리스트

- [ ] Supabase migration 적용 완료
- [ ] `DATABASE_URL`은 Transaction pooler URI로 설정
- [ ] `JWT_SECRET` 32자 이상 무작위 값 설정
- [ ] 관리자 최초 로그인 및 비밀번호 변경
- [ ] 예약금/계좌/회사정보 입력
- [ ] 예약 가능 날짜/capacity 입력
- [ ] `npm run test:regression` 0 fail
- [ ] `npm run lint` exit 0
- [ ] `npm run build` exit 0
- [ ] Vercel 임시 URL에서 예약 → 입금확인 → 최종확정 E2E 테스트
- [ ] 모바일 Safari/Chrome 확인
- [ ] 실제 도메인 연결 후 `SITE_URL` 변경 및 재배포

## DB 레이어

```text
src/database/connection.ts          DB adapter (PostgreSQL / SQLite)
src/database/repositories/*.ts     async repository SQL
src/lib/*.ts                        비즈니스 로직
src/app/api/**                      HTTP API
supabase/migrations/*.sql           운영 PostgreSQL schema
```
