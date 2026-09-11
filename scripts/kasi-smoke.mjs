/**
 * KASI OpenAPI staging smoke test.
 *
 * 실제 인증키로 KASI 응답이 정상인지 확인한다.
 * 인증키는 Git에 저장하지 않고 환경변수로만 전달한다.
 *
 * 사용법:
 *   KASI_SERVICE_KEY='...' node scripts/kasi-smoke.mjs
 *   KASI_SERVICE_KEY='...' node scripts/kasi-smoke.mjs 2027 5
 */
const key = process.env.KASI_SERVICE_KEY?.trim();
if (!key) {
  console.error("KASI_SERVICE_KEY 환경변수가 필요합니다. (Git에 저장하지 마세요)");
  process.exit(1);
}

const year = Number(process.argv[2]) || new Date().getFullYear();
const month = Number(process.argv[3]) || new Date().getMonth() + 1;
const BASE = "https://apis.data.go.kr/B090041/openapi/service";

function assertOk(payload, label) {
  const header = payload?.response?.header;
  if (!header) throw new Error(`${label}: response.header 없음`);
  if (String(header.resultCode) !== "00") {
    throw new Error(`${label}: resultCode=${header.resultCode} ${header.resultMsg ?? ""}`);
  }
  if (payload?.response?.body === undefined) throw new Error(`${label}: body 없음`);
}

async function get(url, label) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const json = await res.json();
  assertOk(json, label);
  return json;
}

function items(payload) {
  const item = payload?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

const failures = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    failures.push(label);
    console.log(`❌ ${label} — ${e.message}`);
  }
}

console.log(`KASI smoke test (${year}-${String(month).padStart(2, "0")})\n`);

await check("특일 정보 (getRestDeInfo)", async () => {
  const url = `${BASE}/SpcdeInfoService/getRestDeInfo?serviceKey=${encodeURIComponent(key)}&solYear=${year}&solMonth=${String(month).padStart(2, "0")}&numOfRows=100&_type=json`;
  const list = items(await get(url, "특일 정보"));
  const holidays = list.filter((i) => String(i.isHoliday).toUpperCase() === "Y");
  return `${list.length}건 조회 / 공휴일 ${holidays.length}건` +
    (holidays.length ? ` (${holidays.map((h) => h.dateName).join(", ")})` : "");
});

await check("음양력 월 단위 (getLunCalInfo)", async () => {
  const url = `${BASE}/LrsrCldInfoService/getLunCalInfo?serviceKey=${encodeURIComponent(key)}&solYear=${year}&solMonth=${String(month).padStart(2, "0")}&numOfRows=40&_type=json`;
  const list = items(await get(url, "음양력 월"));
  if (list.length === 0) throw new Error("월 단위 조회가 0건 — 일 단위 폴백 필요");
  return `${list.length}일 조회`;
});

await check("음양력 일 단위 (getLunCalInfo)", async () => {
  const url = `${BASE}/LrsrCldInfoService/getLunCalInfo?serviceKey=${encodeURIComponent(key)}&solYear=${year}&solMonth=${String(month).padStart(2, "0")}&solDay=15&_type=json`;
  const list = items(await get(url, "음양력 일"));
  if (list.length === 0) throw new Error("0건");
  return `음력 ${list[0].lunMonth}/${list[0].lunDay}`;
});

console.log("");
if (failures.length) {
  console.error(`실패 ${failures.length}건: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("모든 KASI 엔드포인트 정상입니다.");
