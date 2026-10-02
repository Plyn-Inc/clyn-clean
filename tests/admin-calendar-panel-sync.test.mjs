import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("관리자 캘린더는 날짜/슬롯 변경 시 설정 패널을 해당 저장값으로 동기화한다", () => {
  const page = read("src/app/admin/(protected)/calendar/page.tsx");

  assert.match(page, /useEffect\(\(\) => \{[\s\S]*selectedDate[\s\S]*targetSlot[\s\S]*days\[selectedDate\]/);
  assert.match(page, /setStatusChoice\(selectedSlot\.status\)/);
  assert.match(page, /setCapacityInput\(String\(selectedSlot\.capacity\)\)/);
  assert.match(page, /setMemo\(selectedSlot\.memo \?\? ""\)/);
});

test("저장값이 없는 날짜를 선택하면 이전 관리자 메모가 남지 않는다", () => {
  const page = read("src/app/admin/(protected)/calendar/page.tsx");

  assert.match(page, /if \(!selectedSlot\) \{[\s\S]*setStatusChoice\("available"\)[\s\S]*setCapacityInput\("1"\)[\s\S]*setMemo\(""\)/);
  assert.match(page, /if \(!selectedDate\) \{[\s\S]*setMemo\(""\)/);
});

test("날짜/슬롯 변경 시 이전 성공·오류 메시지도 초기화한다", () => {
  const page = read("src/app/admin/(protected)/calendar/page.tsx");
  assert.match(page, /setMsg\(null\);[\s\S]*if \(!selectedDate\)/);
});
