import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("관리자 캘린더는 로딩/실패 시 저장값이 풀린 것처럼 예약 가능으로 위장하지 않는다", () => {
  const page = read("src/app/admin/(protected)/calendar/page.tsx");
  assert.match(page, /if \(!day\) return null/);
  assert.match(page, /오전 확인중/);
  assert.match(page, /오후 확인중/);
  assert.match(page, /if \(!r\.ok\) throw new Error/);
  assert.match(page, /setLoadError\(/);
  assert.doesNotMatch(page, /if \(!day\) return \{ date: dateStr[\s\S]*status: "available"/);
});

test("관리자 날짜 전체 설정은 오전/오후 두 슬롯에 저장하고 legacy all_day 행을 제거한다", () => {
  const calendar = read("src/lib/calendar.ts");
  assert.match(calendar, /legacyAllDay/);
  assert.match(calendar, /calendarRepo\.remove\(date, "all_day"\)/);
  assert.match(calendar, /timeSlot === "all_day"[\s\S]*calendarRepo\.upsert\(date, "morning"/);
  assert.match(calendar, /timeSlot === "all_day"[\s\S]*calendarRepo\.upsert\(date, "afternoon"/);
});

test("all_day available 레코드는 슬롯별 닫힘 상태를 가리지 않는다", () => {
  const calendar = read("src/lib/calendar.ts");
  const route = read("src/app/api/calendar/route.ts");
  assert.match(calendar, /allDayRow && allDayRow\.status !== "available"/);
  assert.match(route, /allDayRow && allDayRow\.status !== "available"/);
});

test("관리자 월 조회는 all_day 점유를 활성 예약 집계에서 파생해 DB 쿼리를 하나 줄인다", () => {
  const calendar = read("src/lib/calendar.ts");
  const rangeSection = calendar.slice(calendar.indexOf("export async function getSlotCalendarRange"), calendar.indexOf("export async function getSlotEffectiveStatus"));
  assert.doesNotMatch(rangeSection, /findAllDayBlockedDates/);
  assert.match(rangeSection, /activeCounts\.get\(\`\$\{date\}\|all_day\`\)/);
});

test("고객 캘린더는 첫 진입에서 이웃 달 prefetch를 현재 달보다 먼저 시작하지 않는다", () => {
  const stable = read("src/components/booking/StableReservationCalendar.tsx");
  assert.match(stable, /if \(cached\) prefetchNeighbors\(\)/);
  const loadSuccess = stable.indexOf("setLoading(false);\n        prefetchNeighbors();");
  assert.ok(loadSuccess >= 0, "현재 달 로드 성공 후 이웃 달 prefetch가 있어야 한다");
  assert.doesNotMatch(stable, /\/\/ 다음\/이전 달은 사용자가 누르기 전에 백그라운드에서 준비한다\.\n    prefetchNeighbors\(\);/);
});
