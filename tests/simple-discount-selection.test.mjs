import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("할인 관리는 이름과 할인금액 중심의 단순 목록 UI를 제공한다", () => {
  const page = read("src/app/admin/(protected)/discounts/page.tsx");
  assert.match(page, /할인 이름/);
  assert.match(page, /할인금액/);
  assert.match(page, /discountType: "fixed"/);
  assert.doesNotMatch(page, /최소 결제금액/);
  assert.doesNotMatch(page, /최대 할인금액/);
  assert.doesNotMatch(page, /우선순위/);
});

test("가격 설정은 할인 선택 버튼으로 여러 할인 항목을 연결한다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /할인 선택/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /promotionIds: pickerIds/);
  assert.match(page, /선택 적용/);
});

test("가격 설정 아래에 별도 이벤트 할인 등록 폼을 두지 않는다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.doesNotMatch(page, /이벤트 할인 등록/);
  assert.doesNotMatch(page, /시작일시/);
  assert.doesNotMatch(page, /종료일시/);
});

test("고객 견적은 가격 항목에 연결된 할인들을 중복 적용한다", () => {
  const lib = read("src/lib/discounts.ts");
  assert.match(lib, /FROM price_rule_discounts prd/);
  assert.match(lib, /for \(const promotion of linkedPromotions\)/);
  assert.match(lib, /automaticDiscountAmount: automatic/);
  assert.match(lib, /promotionNames\.join\(" \+ "\)/);
});


test("calculateDiscounts 구현은 중복 함수 조각 없이 하나만 존재한다", () => {
  const lib = read("src/lib/discounts.ts");
  const count = (lib.match(/\}\): Promise<DiscountBreakdown> \{/g) ?? []).length;
  assert.equal(count, 1);
});
