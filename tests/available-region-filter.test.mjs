import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('고객 지역 API는 예약 가능으로 체크된 지역 계층만 반환한다', () => {
  const repo = read('src/database/repositories/region-repository.ts');
  const api = read('src/app/api/regions/route.ts');
  assert.match(repo, /listAvailableSidos/);
  assert.match(repo, /listAvailableChildren/);
  assert.match(repo, /service_areas[^]*is_enabled = 1/);
  assert.match(api, /listAvailableSidos/);
  assert.match(api, /listAvailableChildren/);
  assert.match(api, /countAreas/);
  assert.doesNotMatch(api, /listByLevel\("sido"\)/);
  assert.doesNotMatch(api, /listChildren\(parent\)/);
});

test('고객 지역 선택은 별도 서비스가능여부 조회 없이 노출된 지역을 즉시 예약가능으로 취급한다', () => {
  const region = read('src/components/booking/RegionSelect.tsx');
  assert.doesNotMatch(region, /fetchServiceAvailability/);
  assert.doesNotMatch(region, /availability=/);
  assert.match(region, /serviceAvailable:\s*true/);
});
