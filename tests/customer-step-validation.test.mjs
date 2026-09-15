import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

test('3단계는 연락처 형식과 상세주소를 다음 단계 전에 검증한다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  assert.match(form, /isValidKoreanPhone\(customerPhone\)/);
  assert.match(form, /연락처 형식을 확인해주세요/);
  assert.match(form, /if \(!address\.trim\(\)\) return "상세 주소를 입력해주세요\."/);
  assert.match(form, /<Field label="상세 주소" required/);
  assert.doesNotMatch(form, /상세 주소 \(선택\)/);
});

test('고객 예약 폼은 이메일을 수집하거나 전송하지 않는다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  assert.doesNotMatch(form, /customerEmail/);
  assert.doesNotMatch(form, /이메일 \(선택\)/);
  assert.doesNotMatch(form, /type="email"/);
});

test('연락처 입력은 자동 구분 포맷을 사용한다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  const utils = read('src/lib/utils.ts');
  assert.match(form, /formatPhoneInput\(v\)/);
  assert.match(utils, /export function formatPhoneInput/);
});

test('기타 요청사항은 선택이며 가이드와 1000자 제한·카운터를 표시한다', () => {
  const form = read('src/components/booking/BookingForm.tsx');
  assert.match(form, /반려동물이 있었음/);
  assert.match(form, /maxLength=\{1000\}/);
  assert.match(form, /\{extraNotes\.length\} \/ 1000자/);
  assert.match(form, /if \(extraNotes\.length > 1000\)/);
});

test('상담 API도 상세주소를 필수로 받고 기타 요청사항은 선택 1000자로 유지한다', () => {
  const api = read('src/app/api/consultations/route.ts');
  assert.match(api, /address: z\.string\(\)\.trim\(\)\.min\(1, "상세 주소를 입력해주세요\."\)\.max\(200\)/);
  assert.match(api, /extraNotes: z\.string\(\)\.max\(1000\)\.optional\(\)/);
  assert.doesNotMatch(api, /if \(!data\.extraNotes\?\.trim\(\)\)/);
});
