import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("가격 관리 상품은 원룸부터 40평 이상까지 규모 순서로 고정 정렬한다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /HOUSE_TYPES_FIXED/);
  assert.match(page, /HOUSE_SIZES_APARTMENT/);
  assert.match(page, /productOrderIndex/);
  assert.match(page, /sortRules/);
});

test("가격 관리 행은 견적금액 할인금액 총결제금액 선금 잔금 순서로 표시한다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  const header = page.indexOf("<span>견적금액</span>");
  const discount = page.indexOf("<span>할인금액</span>");
  const total = page.indexOf("<span>총결제금액</span>");
  const deposit = page.indexOf("<span>선금</span>");
  const balance = page.indexOf("<span>잔금</span>");
  assert.ok(header >= 0 && header < discount && discount < total && total < deposit && deposit < balance);
});

test("가격 관리에서 자동 이벤트 할인을 등록 수정 삭제할 수 있다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /이벤트 할인/);
  assert.match(page, /kind: "promotion"/);
  assert.match(page, /\/api\/admin\/discounts/);
  assert.match(page, /removePromotion/);
});

test("가격 관리 결제 미리보기는 현재 자동 프로모션의 가장 큰 할인 1개를 반영한다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /currentPromotionFor/);
  assert.match(page, /amount > best\.amount/);
  assert.match(page, /const totalPayment = Math\.max\(baseAmount - discountAmount, 0\)/);
  assert.match(page, /const actualDeposit = Math\.min\(configuredDeposit, totalPayment\)/);
});

test("실제 견적도 할인 후 총액보다 큰 선금을 청구하지 않는다", () => {
  const route = read("src/app/api/quote/route.ts");
  assert.match(route, /const finalDeposit = Math\.min\(deposit, finalTotal\)/);
  assert.match(route, /depositAmount: finalDeposit/);
  assert.match(route, /balanceAmount: finalBalance/);
});
