import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("메인 SEO 제목과 설명에 한글 브랜드명과 영문 브랜드명을 함께 제공한다", () => {
  const settings = read("src/lib/settings.ts");
  assert.match(settings, /클린클린케어 \| CLYN CLEAN CARE 입주청소/);
  assert.match(settings, /클린클린케어\(CLYN CLEAN CARE\) 입주·이사청소\. 예약 가능 날짜 확인부터 간편 예약까지\./);
});
