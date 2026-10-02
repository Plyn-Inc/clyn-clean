import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("네이버 서치어드바이저 소유확인 메타태그를 루트 메타데이터에 제공한다", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /naver-site-verification/);
  assert.match(layout, /c2080771798da10946084a6aaf2684ac96a662a1/);
  assert.match(layout, /verification:\s*\{[\s\S]*other:/);
});
