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

test('할인 중 정상가는 빨간 굵은 취소선으로 주 가격보다 먼저 보여준다', () => {
  const offer = read('src/components/OneRoomOfferPrice.tsx');
  const baseIndex = offer.indexOf('offer.basePrice.toLocaleString');
  const openIndex = offer.indexOf('offer.openPrice.toLocaleString');
  assert.ok(baseIndex >= 0, '정상가 표시가 있어야 한다');
  assert.ok(openIndex >= 0, '프로모션가 표시가 있어야 한다');
  assert.ok(baseIndex < openIndex, '정상가 취소선이 프로모션가보다 먼저 보여야 한다');
  assert.match(offer, /text-\[#D14343\]/);
  assert.match(offer, /line-through/);
  assert.match(offer, /decoration-\[#D14343\]/);
  assert.match(offer, /decoration-4/);
});

test('Hero 예약은 compact 캘린더와 compact 폼을 사용한다', () => {
  const section = read('src/components/booking/BookingSection.tsx');
  const matches = section.match(/compact=\{heroLayout\}/g) || [];
  assert.equal(matches.length, 2);

  const calendar = read('src/components/booking/ReservationCalendar.tsx');
  assert.match(calendar, /compact\?: boolean/);

  const form = read('src/components/booking/BookingForm.tsx');
  assert.match(form, /compact\?: boolean/);
  assert.match(form, /!compact && isOneRoomMode/);
});

test('헤더 로고는 배경 없이 보이도록 흰색 픽셀을 제거한다', () => {
  const header = read('src/components/SiteHeader.tsx');
  assert.match(header, /mix-blend-multiply/);
});
