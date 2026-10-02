import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("가격 관리 로딩은 가격 설정 할인 API 실패를 서로 격리한다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /priceLoadError/);
  assert.match(page, /discountLoadError/);
  assert.match(page, /settingsLoadError/);
});

test("할인 API 실패만으로 가격표를 비우지 않는다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /discountLoadError && <p>\{discountLoadError\} 가격표는 계속 사용할 수 있습니다/);
  assert.match(page, /promotions=\{discountLoadError \? \[\] : promotions\}/);
});

test("가격 API 실패일 때만 가격표 영역에 명시적 오류를 표시한다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /priceLoadError \? \(/);
  assert.match(page, /가격표를 불러오지 못했습니다/);
});

test("부분 실패 후 관리자가 다시 불러올 수 있다", () => {
  const page = read("src/app/admin/(protected)/pricing/page.tsx");
  assert.match(page, /onClick=\{\(\) => void load\(\)\}/);
  assert.match(page, /다시 불러오기/);
});
