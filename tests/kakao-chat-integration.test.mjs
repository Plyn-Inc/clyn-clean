import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const settings = read("src/lib/settings.ts");
const layout = read("src/app/layout.tsx");
const floating = read("src/components/FloatingKakaoChat.tsx");
const mobileSticky = read("src/components/MobileStickyCta.tsx");
const hero = read("src/components/HeroBanner.tsx");

test("카카오 채팅 URL은 CLYN CLEAN 공식 채팅 주소를 기본값으로 사용한다", () => {
  assert.match(settings, /KAKAO_CHAT_URL\s*=\s*"https:\/\/pf\.kakao\.com\/_xmxgxcrX\/chat"/);
  assert.match(settings, /kakaoUrl:\s*KAKAO_CHAT_URL/);
  assert.match(settings, /company_kakao_url\s*\|\|\s*KAKAO_CHAT_URL/);
});

test("공개 사이트에는 우측 하단 카카오 상담 버튼을 전역 배치한다", () => {
  assert.match(layout, /FloatingKakaoChat/);
  assert.match(layout, /<FloatingKakaoChat\s+href=\{company\.kakaoUrl\}\s*\/>/);
  assert.match(floating, /fixed bottom-5 right-4/);
  assert.match(floating, /카카오톡 상담/);
  assert.match(floating, /09:00~21:00/);
  assert.match(floating, /sendMarketingEvent\("kakao_clicked"\)/);
});

test("관리자 화면과 원룸 전용 랜딩은 중복 고정 버튼을 표시하지 않는다", () => {
  assert.match(floating, /pathname\.startsWith\("\/admin"\)/);
  assert.match(floating, /pathname === "\/one-room"/);
  assert.match(mobileSticky, /카카오톡 문의/);
  assert.match(hero, /카카오톡 문의/);
});
