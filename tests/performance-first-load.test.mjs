import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const home = read("src/app/page.tsx");
const offer = read("src/components/OneRoomOfferPrice.tsx");
const notice = read("src/components/NoticePopup.tsx");
const attribution = read("src/components/MarketingAttributionCapture.tsx");
const hero = read("src/components/HeroBanner.tsx");

test("홈페이지 shell은 force-dynamic으로 매 요청 서버 렌더링을 강제하지 않는다", () => {
  assert.doesNotMatch(home, /export const dynamic\s*=\s*["']force-dynamic["']/);
  assert.match(home, /export const revalidate\s*=\s*60/);
});

test("원룸 가격 표시 컴포넌트는 브라우저 API 요청과 hydration이 필요 없다", () => {
  assert.doesNotMatch(offer, /^"use client"/);
  assert.doesNotMatch(offer, /fetch\("/);
  assert.doesNotMatch(offer, /useEffect|useState/);
  assert.match(offer, /initialOffer/);
});

test("공지 조회는 첫 paint 직후의 critical request 경쟁에서 제외한다", () => {
  assert.match(notice, /requestIdleCallback|setTimeout\(startLoad/);
  assert.match(notice, /cancelIdleCallback|clearTimeout/);
});

test("landing_view 저장도 idle 시점으로 미뤄 초기 렌더와 경쟁하지 않는다", () => {
  assert.match(attribution, /requestIdleCallback|setTimeout\(sendLanding/);
  assert.match(attribution, /sendMarketingEvent\("landing_view"\)/);
});


test("첫 Hero 이미지만 높은 네트워크 우선순위를 사용한다", () => {
  assert.match(hero, /fetchPriority=\\{i === 0 \\? "high" : "low"\\}/);
  assert.match(hero, /loading=\\{i === 0 \\? "eager" : "lazy"\\}/);
});


test("원룸 대표 가격은 첫 HTML에 서버에서 주입되어 hydration 후 추가 API를 기다리지 않는다", () => {
  assert.match(home, /getOneRoomOffer/);
  assert.match(home, /const offer = await getOneRoomOffer\(\)/);
  assert.match(home, /<HeroBanner[^>]*offer=\{offer\}/s);
  assert.match(home, /<OneRoomOfferSection[^>]*offer=\{offer\}/s);
  assert.match(offer, /initialOffer/);
});


const layout = read("src/app/layout.tsx");
const globals = read("src/app/globals.css");
const header = read("src/components/SiteHeader.tsx");
const heroBanner = read("src/components/HeroBanner.tsx");
const ctaBanner = read("src/components/CtaBanner.tsx");
const landingHero = read("src/components/OneRoomLandingHero.tsx");
const oneRoomPage = read("src/app/one-room/page.tsx");
const beforeAfter = read("src/components/BeforeAfterGallery.tsx");
const portfolio = read("src/components/CleaningPortfolio.tsx");
const detail = read("src/components/DetailCleaningFocus.tsx");
const nextConfig = read("next.config.ts");

test("Pretendard 대용량 로컬 폰트는 initial preload 경쟁에서 제외한다", () => {
  assert.match(layout, /preload:\s*false/);
});

test("모바일에서 큰 backdrop blur를 사용하지 않는다", () => {
  assert.doesNotMatch(header, /\sbackdrop-blur(?:\s|")/);
  assert.doesNotMatch(heroBanner, /\sbackdrop-blur(?:\s|")/);
});

test("화면 아래 이미지 섹션은 content-visibility로 초기 렌더 비용을 미룬다", () => {
  assert.match(globals, /\.render-later[\s\S]*content-visibility:\s*auto/);
  for (const src of [beforeAfter, portfolio, detail]) {
    assert.match(src, /render-later/);
  }
});

test("하단 CTA는 client hydration 없이 앵커로 이동한다", () => {
  assert.doesNotMatch(ctaBanner, /^"use client"/);
  assert.match(ctaBanner, /href="#calendar"/);
});

test("원룸 전용 랜딩 Hero는 client hydration과 가격 API 대기를 제거한다", () => {
  assert.doesNotMatch(landingHero, /^"use client"/);
  assert.match(landingHero, /offer:\s*OneRoomOffer\s*\|\s*null/);
  assert.match(landingHero, /href="#calendar"/);
  assert.match(oneRoomPage, /export const revalidate\s*=\s*60/);
  assert.match(oneRoomPage, /getOneRoomOffer/);
  assert.match(oneRoomPage, /<OneRoomLandingHero\s+offer=\{offer\}/);
});


test("하단 작업 사진은 허용된 저용량 품질로 제공한다", () => {
  for (const src of [beforeAfter, portfolio, detail]) {
    assert.match(src, /quality=\{65\}/);
  }
  assert.match(nextConfig, /qualities:\s*\[65,\s*75\]/);
});
