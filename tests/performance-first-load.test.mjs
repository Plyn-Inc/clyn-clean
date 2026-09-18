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

test("원룸 가격 컴포넌트 여러 개가 같은 API 요청을 공유한다", () => {
  assert.match(offer, /let sharedOfferPromise/);
  assert.match(offer, /function loadOfferOnce/);
  assert.match(offer, /sharedOfferPromise \?\?=/);
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
