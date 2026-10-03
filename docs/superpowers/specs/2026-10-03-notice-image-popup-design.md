# CLYN 공지/팝업 이미지 업로드 확장 설계

작성일: 2026-10-03  
대상 저장소: `Plyn-Inc/clyn-clean`  
작업 브랜치: `feat/notice-image-popup`

## 1. 목적

현재 CLYN Admin의 `공지 / 팝업 관리`는 제목과 평문 내용만 저장할 수 있다. 홈페이지 팝업은 `NoticePopup.tsx`에서 텍스트형 공지를 표시하며, 이미지 업로드 기능은 존재하지 않는다.

이번 변경의 목적은 다음과 같다.

- Admin에서 공지/팝업용 이미지를 직접 업로드할 수 있게 한다.
- 업로드한 이미지를 홈페이지 팝업에서 모바일/PC에 적합한 크기로 노출한다.
- 이미지 전체에 선택형 클릭 링크를 설정할 수 있게 한다.
- 링크를 비우면 이미지 클릭 시 아무 동작도 하지 않는다.
- 기존 텍스트형 공지와 팝업은 수정 없이 계속 동작해야 한다.
- 현재의 `닫기`, `오늘 하루 보지 않기`, 팝업 우선순위 정책을 유지한다.

## 2. 현재 구조

확인된 기존 구성:

- 홈페이지 팝업 UI: `src/components/NoticePopup.tsx`
- 공개 팝업 API: `src/app/api/notices/popup/route.ts`
- 공지 도메인: `src/lib/notices.ts`
- 공지 저장소: `src/database/repositories/notice-repository.ts`
- Admin 공지 생성 API: `src/app/api/admin/notices/route.ts`
- Admin 공지 수정/삭제 API: `src/app/api/admin/notices/[id]/route.ts`
- `notices` 테이블은 현재 이미지/링크 컬럼이 없다.
- Admin API는 `requireAdminApiSession()`으로 보호된다.
- 홈페이지 팝업은 한 번에 1건만 표시한다.
- 팝업 후보 우선순위는 긴급 → 고정 → 최신이다.
- `오늘 하루 보지 않기`는 KST 기준 localStorage에 저장한다.

## 3. 채택 아키텍처

### 3.1 업로드 경로

브라우저에서 Supabase Storage에 직접 업로드하지 않는다.

```text
Admin 브라우저
  -> CLYN Admin 업로드 API
  -> requireAdminApiSession()
  -> Supabase Storage
  -> 공개 이미지 URL 반환
```

이 방식을 채택하는 이유:

- 현재 Admin 인증 체계를 그대로 재사용할 수 있다.
- Storage 관리 권한/비밀키를 브라우저에 노출하지 않는다.
- 파일 형식, 용량, 경로를 서버에서 통제할 수 있다.
- 기존 Admin 보안 모델과 일관된다.

### 3.2 Storage

전용 공개 버킷을 사용한다.

- 버킷명: `notice-images`
- 객체 경로: `popup/<고유파일명>.<확장자>`
- 공개 읽기 허용
- 쓰기/삭제는 서버 경로에서만 수행

같은 경로 덮어쓰기는 사용하지 않는다. 이미지 교체 시 새 고유 경로를 만들어 CDN 캐시 혼선을 피한다.

## 4. 데이터 모델

`notices` 테이블에 다음 컬럼을 추가한다.

```sql
popup_image_url TEXT
popup_link_url TEXT
```

의미:

- `popup_image_url`: 팝업 이미지 공개 URL. NULL이면 기존 텍스트 팝업.
- `popup_link_url`: 이미지 클릭 시 이동할 URL. NULL/빈 값이면 클릭 이동 없음.

기존 행은 두 컬럼이 NULL이므로 기존 동작을 유지한다.

## 5. Admin API

### 5.1 이미지 업로드

신규 엔드포인트 예시:

```text
POST /api/admin/notices/upload-image
```

입력:

- multipart/form-data
- `file` 1개

허용 형식:

- `image/png`
- `image/jpeg`
- `image/webp`

최대 용량:

- 5MB

응답:

```json
{
  "ok": true,
  "url": "https://.../storage/v1/object/public/notice-images/popup/..."
}
```

오류:

- 관리자 세션 없음: 401/403
- 파일 없음: 400
- 허용되지 않은 MIME: 400
- 5MB 초과: 413 또는 400
- Storage 실패: 502/500

### 5.2 공지 생성/수정

기존 JSON 스키마에 선택 필드 추가:

- `popupImageUrl: string | null`
- `popupLinkUrl: string | null`

링크 검증 정책:

- 빈 값 허용
- 사이트 내부 상대경로 허용: `/reservation`, `/notice/12`
- 외부 링크는 `http://` 또는 `https://`만 허용
- `javascript:`, `data:` 등 위험 스킴 거부

## 6. Repository / Public DTO

### 6.1 NoticeRow

다음 필드 추가:

- `popup_image_url: string | null`
- `popup_link_url: string | null`

### 6.2 NoticeInput

다음 필드 추가:

- `popupImageUrl: string | null`
- `popupLinkUrl: string | null`

### 6.3 PublicNotice

팝업 UI가 필요한 값만 공개한다.

- `popupImageUrl: string | null`
- `popupLinkUrl: string | null`

Admin 전용 필드는 계속 노출하지 않는다.

## 7. Admin UI

기존 `공지 / 팝업 관리` 작성/수정 폼을 유지하면서 아래 필드를 추가한다.

### 7.1 팝업 이미지

UI:

```text
팝업 이미지
[ 파일 선택 ]

PNG · JPG · WebP / 최대 5MB

[업로드된 이미지 미리보기]
[이미지 제거]
```

동작:

1. 파일 선택
2. 프론트에서 형식/용량 1차 검사
3. 업로드 API 호출
4. 성공 시 반환 URL을 폼 상태에 저장
5. 미리보기 표시
6. 공지 저장 시 `popupImageUrl`과 함께 저장

이미지를 제거하면 공지 저장 시 `popupImageUrl = null`로 갱신한다.

### 7.2 이미지 클릭 링크

UI:

```text
이미지 클릭 링크 (선택)
[ /reservation ]

비워두면 클릭 이동 없음
```

외부 URL 입력도 허용한다.

### 7.3 목록 식별

공지 목록에서 이미지가 있는 항목은 `이미지 팝업` 배지 또는 작은 썸네일로 구분한다.

## 8. 홈페이지 팝업

기존 `NoticePopup.tsx`의 아래 기능을 유지한다.

- 한 번에 1개 팝업
- 팝업 지연 로딩
- 닫기
- 오늘 하루 보지 않기
- KST 날짜 기준
- 팝업 실패가 홈페이지 렌더링을 막지 않음

### 8.1 이미지가 있는 경우

팝업 본문은 이미지 중심으로 렌더링한다.

모바일:

- 좌우 여백 약 16px
- 전체 팝업 최대 높이 약 85vh
- 이미지 비율 유지
- `object-fit: contain`
- 화면 밖으로 넘치면 팝업 컨테이너 내 스크롤 허용

PC:

- 최대 폭 약 500~550px
- 화면 중앙
- 이미지 비율 유지

버튼:

- `닫기`
- `오늘 하루 보지 않기`

기존 텍스트 팝업의 `자세히 보기` 버튼은 이미지형 팝업에서는 표시하지 않는다.

### 8.2 이미지 클릭

- `popupLinkUrl` 없음: 일반 이미지
- 내부 상대경로: Next Link 또는 안전한 내부 이동
- 외부 http/https: 일반 링크
- 필요 시 외부 링크는 새 탭이 아닌 현재 탭 이동으로 통일

### 8.3 이미지가 없는 경우

기존 텍스트 팝업 UI를 그대로 사용한다.

## 9. 접근성

- dialog 역할 유지
- 이미지 `alt`는 공지 제목 사용
- 클릭 가능한 이미지에는 키보드 포커스 가능 요소 사용
- 닫기 버튼 최소 터치 영역 44px 유지
- 이미지 로딩 실패 시 제목/내용 또는 오류 없는 텍스트 fallback 제공

## 10. Storage 보안

- 업로드 API는 반드시 `requireAdminApiSession()` 통과 후 실행
- 클라이언트 코드에 Supabase secret/service role 값 노출 금지
- 공개 버킷은 읽기만 공개
- 쓰기/교체/삭제를 클라이언트가 직접 수행하지 않음
- 랜덤/고유 객체명 사용
- 원본 파일명은 신뢰하지 않고 서버에서 안전한 경로 생성

## 11. 마이그레이션

PostgreSQL 운영 DB:

```sql
ALTER TABLE notices ADD COLUMN IF NOT EXISTS popup_image_url TEXT;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS popup_link_url TEXT;
```

SQLite 개발/테스트 호환을 위해 `runIncrementalMigrations()`에도 동일 의미의 `ALTER TABLE`을 추가한다.

Storage 버킷 생성은 Supabase 운영 환경에 별도로 적용하고, 코드에서는 버킷 존재를 전제로 하되 업로드 실패를 명확히 표시한다.

## 12. 실패 처리

- 이미지 업로드 실패 시 공지 본문 데이터는 자동 저장하지 않는다.
- 업로드 성공 후 공지 저장 실패 시 업로드 객체가 남을 수 있다. 이번 범위에서는 고아 파일 자동 정리 배치는 만들지 않는다.
- 팝업 이미지 로딩 실패가 홈페이지 전체를 막지 않는다.
- 팝업 API 오류 시 현재처럼 팝업만 생략한다.
- 링크 검증 실패 시 공지 저장을 거부하고 관리자에게 메시지를 표시한다.

## 13. 테스트

### Repository / API

- 기존 공지 INSERT/UPDATE가 이미지 필드 NULL로 정상 동작
- 이미지 URL/링크 URL 저장/수정
- 공개 팝업 DTO에 이미지/링크 포함
- 링크 위험 스킴 거부
- 업로드 API 관리자 인증 확인
- 허용 MIME만 성공
- 5MB 초과 거부

### UI

- 이미지 없는 공지 → 기존 텍스트 팝업
- 이미지 있는 공지 → 이미지형 팝업
- 링크 없음 → 이미지 클릭 이동 없음
- 내부 링크 → 정상 이동
- 외부 링크 → 정상 이동
- 오늘 하루 보지 않기 유지
- 모바일 320~430px 너비에서 화면 밖 넘침 없음
- PC에서 최대 폭 유지

### 회귀

- `npm run lint`
- `npm run test:regression`
- `npm run build`
- 필요 시 PostgreSQL 회귀 테스트
- 배포 후 production에서 PC/모바일 실제 확인

## 14. 비범위

이번 변경에는 아래를 포함하지 않는다.

- 여러 팝업 동시 표시
- 팝업 순서 드래그 정렬
- 디바이스별 별도 이미지 2장 업로드
- 이미지 자체 편집/크롭 기능
- 예약/가격표 전용 버튼 생성
- 통계/클릭 추적
- 고아 Storage 객체 자동 청소

## 15. 완료 기준

다음 조건을 모두 만족하면 완료로 본다.

1. Admin에서 PNG/JPG/WebP 이미지를 업로드할 수 있다.
2. 업로드 후 미리보기가 보인다.
3. 선택형 클릭 링크를 저장할 수 있다.
4. 이미지형 팝업이 모바일/PC에서 비율을 유지하며 표시된다.
5. 링크가 없으면 클릭 이동이 없다.
6. 링크가 있으면 지정 위치로 이동한다.
7. 닫기/오늘 하루 보지 않기가 유지된다.
8. 기존 텍스트 공지/팝업이 깨지지 않는다.
9. lint/test/build가 통과한다.
10. production에서 실제 동작을 확인한다.
