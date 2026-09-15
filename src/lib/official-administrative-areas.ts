import { inflateRawSync } from "node:zlib";

export type OfficialAreaLevel = "sido" | "sigungu" | "eupmyeondong";

export interface NormalizedAdministrativeArea {
  code: string;
  name: string;
  level: OfficialAreaLevel;
  parentCode: string | null;
}

export const OFFICIAL_LEGAL_DONG_SOURCE = "https://www.code.go.kr/etc/codeFullDown.do";

interface SourceRow {
  code: string;
  fullName: string;
  status: string;
}

/**
 * code.go.kr의 법정동 전체자료 ZIP에서 첫 번째 텍스트 파일을 추출한다.
 * 중앙 디렉터리를 기준으로 위치를 찾기 때문에 data descriptor가 있는 ZIP도 처리한다.
 */
export function extractFirstTextFileFromZip(input: Uint8Array): Uint8Array {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;

  for (let offset = 0; offset <= buf.length - 46; offset += 1) {
    if (buf.readUInt32LE(offset) !== centralSignature) continue;

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    offset += 46 + fileNameLength + extraLength + commentLength - 1;
    if (fileName.endsWith("/")) continue;
    if (!/\.txt$/i.test(fileName)) continue;
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== localSignature) {
      throw new Error("공식 행정구역 ZIP의 로컬 파일 헤더가 올바르지 않습니다.");
    }

    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) throw new Error("공식 행정구역 ZIP 파일이 손상되었습니다.");

    const compressed = buf.subarray(dataStart, dataEnd);
    if (method === 0) return new Uint8Array(compressed);
    if (method === 8) return new Uint8Array(inflateRawSync(compressed));
    throw new Error(`지원하지 않는 ZIP 압축 방식입니다: ${method}`);
  }

  throw new Error("공식 행정구역 ZIP에서 TXT 파일을 찾지 못했습니다.");
}

function sourceRows(text: string): SourceRow[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter((cols) => /^\d{10}$/.test(String(cols[0] ?? "").trim()))
    .map((cols) => ({
      code: String(cols[0]).trim(),
      fullName: String(cols[1] ?? "").trim().replace(/\s+/g, " "),
      status: String(cols[2] ?? "").trim(),
    }))
    .filter((row) => row.fullName && row.status !== "폐지");
}

/**
 * 법정동 전체자료(법정동코드, 법정동명, 폐지여부)를 고객 선택용 3단계 master로 변환한다.
 * '리' 레벨(코드 마지막 2자리가 00이 아님)은 고객 예약 주소 선택에서는 사용하지 않는다.
 */
export function parseOfficialLegalDongText(text: string): NormalizedAdministrativeArea[] {
  const rows = sourceRows(text);
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const sidoRows = rows.filter((row) => row.fullName.split(" ").length === 1);
  const sidoByName = new Map(sidoRows.map((row) => [row.fullName, row]));

  const findSido = (row: SourceRow): SourceRow | undefined => {
    const firstToken = row.fullName.split(" ")[0];
    return sidoByName.get(firstToken) ?? sidoRows.find((sido) => row.code.startsWith(sido.code.slice(0, 2)));
  };

  const leafRows = rows.filter((row) => {
    if (!row.code.endsWith("00")) return false; // 리 제외
    if (row.fullName.split(" ").length === 1) return false; // 시도 제외
    if (row.code.endsWith("00000")) return false; // 시군구 후보 제외
    return true;
  });

  const usedSigunguCodes = new Set<string>();
  const leafAreas: NormalizedAdministrativeArea[] = [];

  for (const leaf of leafRows) {
    const sido = findSido(leaf);
    if (!sido) continue;

    const candidateCode = `${leaf.code.slice(0, 5)}00000`;
    const candidate = byCode.get(candidateCode);
    const candidateIsDistinctMid = candidate && candidate.code !== sido.code && candidate.fullName !== sido.fullName;
    const parentCode = candidateIsDistinctMid ? candidate.code : sido.code;
    if (candidateIsDistinctMid) usedSigunguCodes.add(candidate.code);

    const parentFullName = candidateIsDistinctMid ? candidate.fullName : sido.fullName;
    const leafName = leaf.fullName.startsWith(`${parentFullName} `)
      ? leaf.fullName.slice(parentFullName.length + 1).trim()
      : leaf.fullName.split(" ").at(-1) ?? leaf.fullName;

    leafAreas.push({
      code: leaf.code,
      name: leafName,
      level: "eupmyeondong",
      parentCode,
    });
  }

  const sidoAreas: NormalizedAdministrativeArea[] = sidoRows.map((row) => ({
    code: row.code,
    name: row.fullName,
    level: "sido",
    parentCode: null,
  }));

  const sigunguAreas: NormalizedAdministrativeArea[] = [...usedSigunguCodes]
    .map((code) => byCode.get(code))
    .filter((row): row is SourceRow => Boolean(row))
    .map((row) => {
      const sido = findSido(row);
      const name = sido && row.fullName.startsWith(`${sido.fullName} `)
        ? row.fullName.slice(sido.fullName.length + 1).trim()
        : row.fullName;
      return {
        code: row.code,
        name,
        level: "sigungu" as const,
        parentCode: sido?.code ?? null,
      };
    })
    .filter((area) => area.parentCode !== null);

  const order: Record<OfficialAreaLevel, number> = { sido: 0, sigungu: 1, eupmyeondong: 2 };
  return [...sidoAreas, ...sigunguAreas, ...leafAreas].sort(
    (a, b) => order[a.level] - order[b.level] || a.code.localeCompare(b.code)
  );
}

/** code.go.kr 공식 법정동 전체자료를 직접 받아 정규화한다. */
export async function fetchOfficialAdministrativeAreas(): Promise<NormalizedAdministrativeArea[]> {
  const body = new URLSearchParams({ codeseId: "법정동코드" });
  const response = await fetch(OFFICIAL_LEGAL_DONG_SOURCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "Clyn-Clean/1.0 administrative-area-sync",
      Referer: "https://www.code.go.kr/stdcode/regCodeL.do",
    },
    body: body.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`공식 행정구역 다운로드 실패 (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("공식 행정구역 응답이 ZIP 형식이 아닙니다.");
  }

  const txtBytes = extractFirstTextFileFromZip(bytes);
  const text = new TextDecoder("euc-kr").decode(txtBytes);
  const areas = parseOfficialLegalDongText(text);

  const sidoCount = areas.filter((area) => area.level === "sido").length;
  const sigunguCount = areas.filter((area) => area.level === "sigungu").length;
  const dongCount = areas.filter((area) => area.level === "eupmyeondong").length;
  if (sidoCount < 15 || sigunguCount < 150 || dongCount < 2000) {
    throw new Error(`공식 행정구역 검증 실패 (시도 ${sidoCount}, 시군구 ${sigunguCount}, 읍면동 ${dongCount})`);
  }

  return areas;
}
