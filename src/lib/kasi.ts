/**
 * 한국천문연구원(KASI) OpenAPI 클라이언트.
 *
 * 두 엔드포인트를 사용한다.
 *   1. 특일 정보 (getRestDeInfo)  — 공휴일/대체공휴일/임시공휴일
 *   2. 음양력 정보 (getLunCalInfo) — 양력→음력 변환 (손없는날 판정)
 *
 * ⚠ 고객 요청 경로에서 직접 호출하지 않는다.
 *    배치 동기화(syncSpecialDays)에서만 사용하고, 조회는 DB 캐시에서 한다.
 *
 * 환경변수:
 *   KASI_SERVICE_KEY — 공공데이터포털 인증키 (URL 디코딩된 원본)
 */

const KASI_BASE = "https://apis.data.go.kr/B090041/openapi/service";
const REST_DE_URL = `${KASI_BASE}/SpcdeInfoService/getRestDeInfo`;
const LUN_CAL_URL = `${KASI_BASE}/LrsrCldInfoService/getLunCalInfo`;

export class KasiUnavailableError extends Error {
  code = "KASI_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "KasiUnavailableError";
  }
}

export function isKasiConfigured(): boolean {
  return !!process.env.KASI_SERVICE_KEY?.trim();
}

function serviceKey(): string {
  const key = process.env.KASI_SERVICE_KEY?.trim();
  if (!key) {
    throw new KasiUnavailableError(
      "KASI_SERVICE_KEY가 설정되지 않았습니다. 공공데이터포털 인증키를 환경변수에 등록해주세요."
    );
  }
  return key;
}

/** 공공데이터포털 정상 응답 코드 */
const RESULT_CODE_OK = "00";

async function fetchJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      // 동기화 배치에서만 호출되므로 캐시하지 않는다
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    // timeout / network failure
    const reason = e instanceof Error ? e.message : String(e);
    throw new KasiUnavailableError(`KASI 호출 실패: ${reason}`);
  }

  if (!res.ok) {
    throw new KasiUnavailableError(`KASI 응답 오류 (HTTP ${res.status})`);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    // XML 오류 응답 등 JSON이 아닌 경우
    throw new KasiUnavailableError("KASI 응답을 JSON으로 해석할 수 없습니다.");
  }

  assertKasiOk(payload);
  return payload;
}

/**
 * 공공데이터 API의 응답 header/resultCode를 검증한다.
 *
 * HTTP 200이어도 resultCode가 "00"이 아니면 오류다.
 * API-level 오류를 "공휴일 없음"으로 오인하면 요금이 잘못 계산되므로
 * 반드시 여기서 걸러낸다.
 */
export function assertKasiOk(payload: unknown): void {
  const response = (payload as { response?: unknown })?.response;
  if (!response || typeof response !== "object") {
    throw new KasiUnavailableError("KASI 응답 형식이 올바르지 않습니다 (response 없음).");
  }
  const header = (response as { header?: unknown }).header;
  if (!header || typeof header !== "object") {
    throw new KasiUnavailableError("KASI 응답 형식이 올바르지 않습니다 (header 없음).");
  }
  const code = String((header as { resultCode?: unknown }).resultCode ?? "");
  const msg = String((header as { resultMsg?: unknown }).resultMsg ?? "");
  if (code !== RESULT_CODE_OK) {
    throw new KasiUnavailableError(`KASI API 오류 (resultCode=${code}${msg ? `, ${msg}` : ""})`);
  }
  const body = (response as { body?: unknown }).body;
  if (body === undefined || body === null) {
    throw new KasiUnavailableError("KASI 응답 형식이 올바르지 않습니다 (body 없음).");
  }
}

/** KASI 응답에서 item 배열을 안전하게 꺼낸다 (0건이면 빈 배열) */
function extractItems(payload: unknown): Record<string, unknown>[] {
  const body = (payload as { response?: { body?: unknown } })?.response?.body;
  if (!body) return [];
  const items = (body as { items?: unknown }).items;
  if (!items || typeof items !== "object") return [];
  const item = (items as { item?: unknown }).item;
  if (!item) return [];
  return Array.isArray(item) ? (item as Record<string, unknown>[]) : [item as Record<string, unknown>];
}

export interface KasiHoliday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
}

/**
 * 특일 정보 — 해당 연·월의 공휴일 목록.
 * isHoliday === "Y"인 항목만 반환한다 (기념일 등 비휴일 제외).
 */
export async function fetchHolidays(year: number, month: number): Promise<KasiHoliday[]> {
  const url =
    `${REST_DE_URL}?serviceKey=${encodeURIComponent(serviceKey())}` +
    `&solYear=${year}&solMonth=${String(month).padStart(2, "0")}` +
    `&numOfRows=100&_type=json`;
  const items = extractItems(await fetchJson(url));

  return items
    .filter((i) => String(i.isHoliday ?? "").toUpperCase() === "Y")
    .map((i) => {
      const locdate = String(i.locdate ?? "");
      return {
        date: `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`,
        name: String(i.dateName ?? "공휴일"),
      };
    })
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date));
}

/**
 * 음양력 정보 — 양력 하루의 음력 일자.
 * 손없는날 판정(음력 9·10·19·20·29·30일)에 사용한다.
 */
export async function fetchLunarDay(dateStr: string): Promise<number | null> {
  const [y, m, d] = dateStr.split("-");
  const url =
    `${LUN_CAL_URL}?serviceKey=${encodeURIComponent(serviceKey())}` +
    `&solYear=${y}&solMonth=${m}&solDay=${d}&_type=json`;
  const items = extractItems(await fetchJson(url));
  if (items.length === 0) return null;
  const lunDay = Number(items[0].lunDay);
  return Number.isFinite(lunDay) ? lunDay : null;
}

/**
 * 음양력 정보 — 한 달치를 한 번에 조회한다.
 *
 * getLunCalInfo는 solDay를 생략하면 해당 월 전체를 반환한다.
 * 하루 단위 순차 호출(426회) 대신 월 단위(약 14회)로 줄이기 위해 사용한다.
 * 월 단위 조회가 실패하면 호출부가 일 단위로 폴백한다.
 *
 * @returns Map<YYYY-MM-DD, 음력 일자>
 */
export async function fetchLunarMonth(year: number, month: number): Promise<Map<string, number>> {
  const url =
    `${LUN_CAL_URL}?serviceKey=${encodeURIComponent(serviceKey())}` +
    `&solYear=${year}&solMonth=${String(month).padStart(2, "0")}` +
    `&numOfRows=40&_type=json`;
  const items = extractItems(await fetchJson(url));

  const map = new Map<string, number>();
  for (const i of items) {
    const solYear = String(i.solYear ?? "");
    const solMonth = String(i.solMonth ?? "").padStart(2, "0");
    const solDay = String(i.solDay ?? "").padStart(2, "0");
    const lunDay = Number(i.lunDay);
    if (!/^\d{4}$/.test(solYear) || !Number.isFinite(lunDay)) continue;
    map.set(`${solYear}-${solMonth}-${solDay}`, lunDay);
  }
  return map;
}
