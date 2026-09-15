import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('관리자 서비스지역은 카드 토글이 아니라 시군구 체크박스로 설정한다', () => {
  const page = read('src/app/admin/(protected)/service-areas/page.tsx');
  assert.match(page, /type="checkbox"/);
  assert.match(page, /checked=\{enabledCodes\.has\(g\.code\)\}/);
  assert.match(page, /onChange=\{\(e\) => void toggle\(g\.code, e\.target\.checked\)\}/);
  assert.doesNotMatch(page, /상담 전환<\/span>/);
});

test('고객 지역목록은 행정구역 계층을 캐시하고 서비스 가능여부만 선택 시 별도 조회한다', () => {
  const region = read('src/components/booking/RegionSelect.tsx');
  const api = read('src/app/api/regions/route.ts');
  assert.match(region, /const areaCache = new Map/);
  assert.match(region, /fetchServiceAvailability/);
  assert.match(api, /searchParams\.get\("availability"\)/);
  assert.match(api, /isServiceArea/);
  assert.match(api, /public, max-age=/);
  assert.doesNotMatch(api, /enabledServiceAreaCodes/);
});

test('캘린더 상태는 예약가능 예약불가 상담필요 3개만 사용하고 휴무를 노출하지 않는다', () => {
  const types = read('src/lib/types.ts');
  const admin = read('src/app/admin/(protected)/calendar/page.tsx');
  const api = read('src/app/api/admin/calendar/route.ts');
  assert.match(types, /export type CalendarStatus = "available" \| "closed" \| "consult_required";/);
  assert.match(types, /closed: "예약 불가"/);
  assert.doesNotMatch(types, /휴무|"off"/);
  assert.doesNotMatch(api, /"off"/);
  assert.doesNotMatch(admin, /off:/);
  assert.match(admin, /closed: "bg-\[#FDE2E2\][^"]*text-\[#B42318\]/);
  assert.match(admin, /consult_required: "bg-\[#FFF0D9\][^"]*text-\[#A15C00\]/);
});
