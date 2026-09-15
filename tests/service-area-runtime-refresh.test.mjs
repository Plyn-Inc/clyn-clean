import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('서비스지역 API는 동기화 직후 최신 행정구역을 강제로 조회한다', () => {
  const adminApi = read('src/app/api/admin/service-areas/route.ts');
  const publicApi = read('src/app/api/regions/route.ts');
  assert.match(adminApi, /export const dynamic = ["']force-dynamic["']/);
  assert.match(adminApi, /export const revalidate = 0/);
  assert.match(publicApi, /export const dynamic = ["']force-dynamic["']/);
  assert.match(publicApi, /export const revalidate = 0/);
  assert.match(publicApi, /areaCount: total/);
});

test('관리자 서비스지역 화면은 no-store로 지역 목록을 다시 읽고 실패를 숨기지 않는다', () => {
  const page = read('src/app/admin/(protected)/service-areas/page.tsx');
  assert.match(page, /fetch\("\/api\/regions", \{ cache: "no-store" \}\)/);
  assert.match(page, /fetch\("\/api\/admin\/service-areas", \{ cache: "no-store" \}\)/);
  assert.match(page, /지역 목록을 불러오지 못했습니다/);
  assert.match(page, /setSidoList\(regionData\.areas \?\? \[\]\)/);
  assert.match(page, /setAreaCount\(regionData\.areaCount \?\? 0\)/);
});
