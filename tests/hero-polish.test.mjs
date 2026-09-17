import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Hero 우측은 캘린더/예약창만 남기고 좌우 비율을 맞춘다', () => {
  const hero = read('src/components/HeroBanner.tsx');
  assert.doesNotMatch(hero, /예약 가능한 날짜와 지역을 바로 확인하세요/);
  assert.doesNotMatch(hero, /날짜를 선택한 뒤 지역과 고객정보/);
  assert.match(hero, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
});

test('할인 중에는 정상가를 빨간 취소선으로 함께 보여준다', () => {
  const offer = read('src/components/OneRoomOfferPrice.tsx');
  assert.match(offer, /offer\.basePrice/);
  assert.match(offer, /line-through/);
  assert.match(offer, /text-\[#D14343\]/);
  assert.match(offer, /decoration-2/);
});

test('Hero 예약은 기존 로직을 유지하면서 캘린더와 폼의 세로 길이를 줄인다', () => {
  const section = read('src/components/booking/BookingSection.tsx');
  assert.match(section, /heroCompactClass/);
  assert.match(section, /\[&_#calendar_button\]:min-h-\[30px\]/);
  assert.match(section, /\[&_#calendar>div\]:p-3/);
  assert.match(section, /\[&_#booking>div\]:p-4/);
  assert.doesNotMatch(section, /compact=\{heroLayout\}/);
});

test('헤더 로고의 흰 사각 배경이 보이지 않도록 블렌딩한다', () => {
  const header = read('src/components/SiteHeader.tsx');
  const matches = header.match(/mix-blend-multiply/g) || [];
  assert.equal(matches.length, 2);
});
