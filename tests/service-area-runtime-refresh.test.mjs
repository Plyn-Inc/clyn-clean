import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('관리자 서비스지역 API는 최신 ON OFF 설정을 no-store로 조회한다', () => {
  const adminApi = read('src/app/api/admin/service-areas/route.ts');
  assert.match(adminApi, /export const dynamic = ["']force-dynamic["']/);
  assert.match(adminApi, /export const revalidate = 0/);
  assert.match(adminApi, /Cache-Control[^]*no-store/);
});

test('고객 행정구역 계층은 예약 가능지역만 서버 캐시하고 같은 화면에서도 재사용한다', () => {
  const publicApi = read('src/app/api/regions/route.ts');
  const publicCache = read('src/lib/public-region-cache.ts');
  const region = read('src/components/booking/RegionSelect.tsx');
  assert.match(publicApi, /listCachedAvailableSidos/);
  assert.match(publicApi, /listCachedAvailableChildren/);
  assert.match(publicCache, /listAvailableSidos/);
  assert.match(publicCache, /listAvailableChildren/);
  assert.match(publicCache, /unstable_cache/);
  assert.match(region, /const areaCache = new Map/);
  assert.doesNotMatch(region, /cache: "no-store"/);
  assert.doesNotMatch(region, /fetchServiceAvailability/);
});

test('관리자 서비스지역 화면은 master와 설정 오류를 숨기지 않는다', () => {
  const page = read('src/app/admin/(protected)/service-areas/page.tsx');
  assert.match(page, /fetch\("\/api\/admin\/service-areas", \{ cache: "no-store" \}\)/);
  assert.match(page, /지역 목록을 불러오지 못했습니다/);
  assert.match(page, /setSidoList\(regionData\.areas \?\? \[\]\)/);
  assert.match(page, /setAreaCount\(adminData\.areaCount \?\? 0\)/);
});
