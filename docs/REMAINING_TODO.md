# 남은 작업 추적 (누락 방지)

## 할인 UI — 엔진은 완료(384/384), UI 미완료

최종 Admin/고객 통합 단계의 **필수 작업**이다. 누락하지 않는다.

### 고객
- [ ] 견적 화면 할인 breakdown (정상가 / 자동 프로모션 / 쿠폰 / 최종 견적)
- [ ] 쿠폰 코드 입력 · 적용 · 해제
- [ ] 쿠폰 적용/해제 시 **새 quoteToken 재발급** (브라우저에서 금액 객체 수정 금지)

### Admin
- [ ] 할인 관리 메뉴 (프로모션 / 쿠폰 탭)
- [ ] 프로모션 CRUD
- [ ] 쿠폰 CRUD · 중지 · 사용현황
- [ ] 예약 상세 관리자 수동 할인 UI
- [ ] 할인 audit(`reservation_discount_adjustments`) 표시

## 완료된 백엔드 (재설계 금지)

```
할인 계산 엔진        src/lib/discounts.ts
쿠폰 redemption       reservation-repository.redeemCouponInTransaction (FOR UPDATE)
관리자 adjustment     reservations.applyAdminDiscount
quoteToken 할인 서명  quote-token.ts CANONICAL_KEYS
```
