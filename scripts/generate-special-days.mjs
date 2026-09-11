/**
 * special-days.ts의 공휴일/손없는날 데이터를 재생성한다.
 *
 * 사용법: node scripts/generate-special-days.mjs 2029
 *
 * - 음력 변환은 한국천문연구원(KASI) 기준 korean-lunar-calendar를 사용한다
 * - 손없는날 = 음력 9·10·19·20·29·30일
 * - 공휴일/대체공휴일 규칙은 scripts/generate-holidays.mjs 참고
 *
 * 예약 가능 기간이 SUPPORTED_YEARS.max를 넘기기 전에 반드시 실행해
 * 데이터를 확장해야 한다. 확장하지 않으면 서버가 해당 날짜 예약을 거부한다.
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const KLC = require("korean-lunar-calendar");
const SON = new Set([9, 10, 19, 20, 29, 30]);
const pad = (n) => String(n).padStart(2, "0");

const year = Number(process.argv[2]);
if (!year) {
  console.error("사용법: node scripts/generate-special-days.mjs <연도>");
  process.exit(1);
}

const sonDays = [];
for (let m = 1; m <= 12; m++) {
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) {
    const c = new KLC();
    if (!c.setSolarDate(year, m, d)) continue;
    const l = c.getLunarCalendar();
    if (l && SON.has(l.day)) sonDays.push(`${year}-${pad(m)}-${pad(d)}`);
  }
}

console.log(`// 손없는날 ${year} (${sonDays.length}일)`);
for (let i = 0; i < sonDays.length; i += 6) {
  console.log("  " + sonDays.slice(i, i + 6).map((s) => `"${s}"`).join(", ") + ",");
}
console.log("");
console.log(execSync(`node ${new URL("./generate-holidays.mjs", import.meta.url).pathname} ${year}`, { encoding: "utf8" }));
