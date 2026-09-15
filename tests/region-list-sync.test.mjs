import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const read = (p) => fs.readFileSync(p, 'utf8');

function makeZipEntry(name, content, method = 8) {
  const nameBuf = Buffer.from(name, 'utf8');
  const raw = Buffer.from(content, 'utf8');
  const compressed = method === 8 ? deflateRawSync(raw) : raw;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(0, 14); // CRC is not needed by our reader
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const localPart = Buffer.concat([local, nameBuf, compressed]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localPart, centralPart, eocd]);
}

test('고객 지역 선택은 자유입력 fallback 없이 시도-시군구-읍면동 목록만 사용한다', () => {
  const region = read('src/components/booking/RegionSelect.tsx');
  const form = read('src/components/booking/BookingForm.tsx');

  assert.doesNotMatch(region, /manualValue|onManualChange/);
  assert.doesNotMatch(region, /<input[^>]+type="text"/);
  assert.match(region, /시\/도 선택/);
  assert.match(region, /시\/군\/구 선택/);
  assert.match(region, /읍\/면\/동 선택/);
  assert.match(region, /imported === false[^]*disabled/);

  assert.doesNotMatch(form, /manualAreaText/);
  assert.match(form, /regionConsultRequired = region\.serviceAvailable === false/);
  assert.match(form, /regionMasterImported === false[^]*행정구역/);
});

test('관리자 서비스지역 화면은 공식 master 동기화와 시군구 체크박스를 제공한다', () => {
  const page = read('src/app/admin/(protected)/service-areas/page.tsx');
  assert.match(page, /공식 행정구역 불러오기/);
  assert.match(page, /\/api\/admin\/service-areas\/sync/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /예약 가능지역 체크/);
});

test('공식 master 동기화는 code.go.kr 법정동 전체자료를 직접 사용한다', () => {
  const src = read('src/lib/official-administrative-areas.ts');
  assert.match(src, /https:\/\/www\.code\.go\.kr\/etc\/codeFullDown\.do/);
  assert.match(src, /codeseId/);
  assert.match(src, /법정동코드/);
  assert.match(src, /euc-kr/);
});

test('공식 법정동 텍스트를 시도-시군구-읍면동 3단 master로 정규화한다', async () => {
  const { parseOfficialLegalDongText } = await import('../src/lib/official-administrative-areas.ts');
  const text = [
    '법정동코드\t법정동명\t폐지여부',
    '1100000000\t서울특별시\t존재',
    '1168000000\t서울특별시 강남구\t존재',
    '1168010100\t서울특별시 강남구 역삼동\t존재',
    '1168010101\t서울특별시 강남구 역삼동 역삼리\t존재',
    '1174000000\t서울특별시 강동구\t폐지',
  ].join('\n');

  const areas = parseOfficialLegalDongText(text);
  assert.deepEqual(areas, [
    { code: '1100000000', name: '서울특별시', level: 'sido', parentCode: null },
    { code: '1168000000', name: '강남구', level: 'sigungu', parentCode: '1100000000' },
    { code: '1168010100', name: '역삼동', level: 'eupmyeondong', parentCode: '1168000000' },
  ]);
});

test('공식 ZIP에서 deflate 텍스트 엔트리를 추출한다', async () => {
  const { extractFirstTextFileFromZip } = await import('../src/lib/official-administrative-areas.ts');
  const content = '법정동코드\t법정동명\t폐지여부\n1100000000\t서울특별시\t존재\n';
  const zip = makeZipEntry('법정동코드 전체자료.txt', content, 8);
  const extracted = extractFirstTextFileFromZip(zip);
  assert.equal(Buffer.from(extracted).toString('utf8'), content);
});

test('시군구 단계가 없는 지역은 시도 자체를 관리자 서비스지역 ON OFF key로 사용한다', () => {
  const page = read('src/app/admin/(protected)/service-areas/page.tsx');
  const region = read('src/components/booking/RegionSelect.tsx');
  const api = read('src/app/api/regions/route.ts');
  const cache = read('src/lib/public-region-cache.ts');

  assert.match(page, /const directDongMode =/);
  assert.match(page, /directDongMode[^]*toggle\(sido,/);
  assert.match(region, /sigunguCode:\s*value\.sidoCode[^]*sigunguName:\s*value\.sidoName/);
  assert.match(region, /sigunguCode:\s*value\.sidoCode[^]*serviceAvailable:\s*true/);
  assert.match(api, /listCachedAvailableChildren/);
  assert.match(cache, /listAvailableChildren/);
});

test('고객 지역선택이 구조화된 지역 코드를 만들고 예약 제출은 선택 결과를 그대로 저장한다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const api = read('src/app/api/reservations/route.ts');
  assert.match(form, /areaSidoCode/);
  assert.match(form, /areaSigunguCode/);
  assert.match(form, /areaDongCode/);
  assert.match(api, /areaSidoCode/);
  assert.match(api, /areaSigunguCode/);
  assert.match(api, /areaDongCode/);
  assert.doesNotMatch(api, /getReservationAreaStatus/);
});
