# Clyn Clean 원룸 광고 전환 퍼널 설계

## 목표

기존 예약/가격/Admin 엔진을 유지하면서 메인 `/`을 일반 원룸 우선 판매 구조로 재배치하고, 네이버/당근 광고 전용 `/one-room` 랜딩과 일반 원룸 전용 간소화 예약모드, 광고 유입 attribution을 추가한다.

## 상품 계약

- 광고상품: `입주청소` + `원룸`
- 표시명: `일반 원룸 입주·퇴실청소`
- 고객 표시가격: 현재 활성 자동 프로모션이 반영된 `CLYN OPEN PRICE`
- 1.5룸, `원룸 복층`, 투룸 이상은 `/one-room` 온라인 예약 대상에서 제외한다.
- 기존 일반 예약의 `원룸 복층` 상품/가격은 삭제하지 않는다.
- `/one-room` 예약은 `serviceType=입주청소`, `houseTypeKey=원룸`으로 고정한다.
- 고객은 `입주 전` 또는 `퇴거 후`만 선택한다. `거주 중`은 광고 랜딩에서 제외한다.
- `/one-room`은 상품 선택지를 `원룸`으로 고정한다. 복층·1.5룸 여부를 별도로 질문하거나 제출을 차단하는 확인 절차는 두지 않는다.

## 메인 `/`

순서: Hero → 원룸 신뢰포인트 → Before/After → 원룸 OPEN PRICE → 원룸 범위/별도작업 → 예약 → 후기 → 기타서비스 → 블로그/문의.

Hero 핵심 메시지:
- `원룸 입주·퇴실청소`
- `복잡하게 견적받지 마세요.`
- `CLYN OPEN PRICE`
- 활성 프로모션이 반영된 가격
- 작업 전 추가비용 사전 안내 / 작업 완료사진 제공
- CTA: `예약 가능일 확인`, `빠른 견적 받기`

## `/one-room`

광고 이탈을 줄이기 위해 헤더는 로고 + 카카오 문의 수준으로 단순화한다. 페이지 순서는 Hero → 대상/제외조건 → 신뢰포인트 → Before/After → 포함/별도 작업 → 예약 가능일/간소화 예약 → 후기 → 모바일 고정 CTA다. 다른 청소 서비스는 노출하지 않는다.

## OPEN PRICE

가격을 JSX에 하드코딩하지 않는다. `price_rules(입주청소, 원룸)`의 기준가격과 현재 활성 자동 프로모션을 서버에서 계산해 공개 offer API로 제공한다. Hero/가격카드는 이 API를 클라이언트에서 읽어 first shell의 DB blocking을 만들지 않는다. API 실패 시 숫자 가격을 임의 생성하지 않고 `가격 확인 중`/`예약에서 최종 확인`으로 처리한다.

## 예약모드

기존 `BookingForm`/`BookingSection`을 공유한다. `mode="one-room"`에서 서비스/주택유형 선택을 숨기고 `입주청소/원룸`을 초기값으로 고정한다. 복층·1.5룸 여부를 별도 검증하지 않는다. 일반 모드는 기존 기능을 그대로 유지한다. `/one-room` 모드는 `before_move_in`, `after_move_out`만 허용한다.

## 광고 attribution

최초/최종 유입을 브라우저 localStorage에 보존한다. 표준 `utm_source/utm_medium/utm_campaign/utm_term`과 간단 파라미터 `source/medium/campaign/keyword`를 모두 정규화한다. 예약 제출 시 attribution snapshot을 함께 보내 DB에 저장한다.

예약 저장 필드:
- `visitor_id`
- `first_source`, `first_medium`, `first_campaign`, `first_keyword`
- `last_source`, `last_medium`, `last_campaign`, `last_keyword`
- `landing_page`, `first_visit_at`

행동 이벤트는 별도 `marketing_events` 테이블에 PII 없이 저장한다. 1차 이벤트: `landing_view`, `booking_started`, `booking_completed`, `kakao_clicked`. `booking_completed`는 예약 저장 성공 후 서버에서 기록한다.

## Admin

예약 상세에서 최초 유입/캠페인/키워드/랜딩 페이지를 표시한다. 대시보드 집계는 이번 범위에서 제외한다.

## 비범위

- 사진 업로드/Storage
- 별도 원룸 예약 백엔드
- 일반 예약의 복층 상품 삭제
- 가격/예약금/할인/캘린더 핵심 도메인 재설계
- 마케팅 분석 대시보드
