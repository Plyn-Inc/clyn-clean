import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const terms = fs.readFileSync(path.join(process.cwd(), "src/app/terms/page.tsx"), "utf8");
const privacy = fs.readFileSync(path.join(process.cwd(), "src/app/privacy/page.tsx"), "utf8");

test("이용약관은 준비중 문구 없이 기본 서비스 약관을 공개한다", () => {
  assert.doesNotMatch(terms, /약관은 준비 중|관리자 설정에서 입력/);
  for (const heading of ["목적", "예약 및 계약의 성립", "서비스 요금 및 결제", "예약 변경 및 취소", "서비스 제공", "이용자의 의무", "책임의 제한", "분쟁 해결"]) assert.match(terms, new RegExp(heading));
});

test("개인정보처리방침은 법정 기본 공개 항목을 포함한다", () => {
  assert.doesNotMatch(privacy, /관리자 설정 필요|법률 전문가의 검토/);
  for (const heading of ["처리 목적", "처리하는 개인정보", "보유 및 이용기간", "제3자 제공", "처리위탁", "파기", "정보주체의 권리", "안전성 확보", "개인정보 보호책임", "처리방침의 변경"]) assert.match(privacy, new RegExp(heading));
  assert.match(privacy, /SOLAPI|솔라피/);
});

test("정책 페이지는 DB 커스텀 내용이 없어도 완성된 기본 문서를 표시한다", () => {
  assert.match(terms, /getCompanySettingsSafe/);
  assert.match(privacy, /getCompanySettingsSafe/);
  assert.doesNotMatch(terms, /settings\.terms_content/);
  assert.doesNotMatch(privacy, /privacy_policy_content/);
});
