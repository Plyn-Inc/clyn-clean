import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('메인 Hero는 데스크톱 2열에서 우측에 원룸 예약 캘린더와 폼을 함께 둔다', () => {
  const hero = read('src/components/HeroBanner.tsx');
  assert.match(hero, /BookingSection/);
  assert.match(hero, /mode="one-room"/);
  assert.match(hero, /layout="hero"/);
  assert.match(hero, /lg:grid-cols/);
  assert.match(hero, /예약 가능한 날짜와 지역을 바로 확인하세요/);
});

test('Hero 예약 레이아웃은 모바일에서 세로 스택이고 캘린더가 폼보다 먼저 나온다', () => {
  const section = read('src/components/booking/BookingSection.tsx');
  assert.match(section, /layout\?: "default" \| "hero"/);
  assert.match(section, /layout === "hero"/);
  assert.ok(section.indexOf('<ReservationCalendar') < section.indexOf('<BookingForm'), '모바일 Hero에서는 캘린더가 폼보다 먼저 와야 한다');
});

test('메인 판매 흐름은 Hero 예약 뒤 신뢰→가격→범위→결과→후기→기타서비스 순서다', () => {
  const page = read('src/app/page.tsx');
  const order = [
    'HeroBanner',
    'OneRoomTrustPoints',
    'OneRoomOfferSection',
    'OneRoomScope',
    'BeforeAfterGallery',
    'ReviewsPreview',
    'ServiceList',
  ];
  for (let i = 0; i < order.length - 1; i += 1) {
    assert.ok(page.indexOf(order[i]) < page.indexOf(order[i + 1]), `${order[i]}가 ${order[i + 1]}보다 먼저 와야 한다`);
  }
  assert.doesNotMatch(page, /<section id="reserve"/);
});
