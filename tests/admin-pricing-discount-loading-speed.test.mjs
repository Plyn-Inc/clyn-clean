import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("할인 계산 함수가 정상적으로 닫혀 빌드 가능한 형태다", () => {
  const lib = read("src/lib/discounts.ts").trim();
  assert.ok(lib.endsWith("}"));
  const openings = (lib.match(/export async function calculateDiscounts/g) ?? []).length;
  assert.equal(openings, 1);
});

test("가격 관리는 4개 API 대신 단일 overview API를 사용한다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /\/api\/admin\/pricing-overview/);
  assert.doesNotMatch(page, /Promise\.all\(\[\s*fetch\("\/api\/admin\/price-rules"/);
  assert.match(page, /PRICING_OVERVIEW_CACHE_MS = 30_000/);
});

test("pricing overview는 가격 할인 연결 휴일가산금을 한 DB query로 읽는다", () => {
  const route = read("src/app/api/admin/pricing-overview/route.ts");
  assert.match(route, /FROM price_rules/);
  assert.match(route, /FROM discount_promotions/);
  assert.match(route, /FROM price_rule_discounts/);
  assert.match(route, /WHERE key = 'holiday_surcharge'/);
  assert.equal((route.match(/queryRows</g) ?? []).length, 1);
});

test("할인 관리는 첫 진입에서 쿠폰까지 동시에 불러오지 않는다", () => {
  const page = read("src/app/admin/(protected)/discounts/page.tsx");
  assert.match(page, /await loadPromotions\(\)/);
  assert.match(page, /next !== "coupon" \|\| couponsLoaded/);
  assert.doesNotMatch(page, /Promise\.all\(\[loadPromotions\(\), loadCoupons\(\)\]\)/);
});

test("휴일 가산금은 관리자 설정 API에서 실제 저장 허용된다", () => {
  const route = read("src/app/api/admin/settings/route.ts");
  assert.match(route, /"holiday_surcharge"/);
});
