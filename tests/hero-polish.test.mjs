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

test('헤더 로고는 투명 배경 자산을 사용한다', () => {
  const images = read('src/lib/images.ts');
  assert.match(images, /clyn-clean-care-logo-transparent\.png/);
});
