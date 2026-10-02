import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("공개 사이트 우측 하단에 전화 문의와 카카오 상담 액션을 함께 제공한다", () => {
  const floating = read("src/components/FloatingKakaoChat.tsx");
  const layout = read("src/app/layout.tsx");
  assert.match(floating, /전화 문의/);
  assert.match(floating, /tel:/);
  assert.match(floating, /phone_clicked/);
  assert.match(floating, /카카오톡 상담/);
  assert.match(layout, /phone=\{company\.phone\}/);
});

test("원룸 모바일 하단 CTA에도 전화 문의를 제공한다", () => {
  const sticky = read("src/components/MobileStickyCta.tsx");
  const page = read("src/app/one-room/page.tsx");
  assert.match(sticky, /grid-cols-3/);
  assert.match(sticky, /전화 문의/);
  assert.match(sticky, /phone_clicked/);
  assert.match(page, /phone=\{company\.phone\}/);
});

test("전화 문의 클릭을 마케팅 이벤트로 수집할 수 있다", () => {
  const marketing = read("src/lib/marketing-attribution.ts");
  const route = read("src/app/api/marketing/events/route.ts");
  assert.match(marketing, /"phone_clicked"/);
  assert.match(route, /"phone_clicked"/);
});
