/**
 * 행정구역 master 임포트.
 *
 * 공식 행정안전부 행정구역 코드 데이터를 administrative_areas에 적재한다.
 * 관리자가 임의 문자열로 지역을 만들 수 없도록, 등록 경로는 이 스크립트뿐이다.
 *
 * 사용법:
 *   node scripts/import-administrative-areas.mjs <파일> [--dry-run]
 *
 * 지원 포맷:
 *   CSV  — 헤더: code,name,level,parent_code[,is_current]
 *   JSON — [{ "code": "11", "name": "서울특별시", "level": "sido", "parent_code": null }, ...]
 *
 * level: sido | sigungu | eupmyeondong
 *
 * 검증 (하나라도 실패하면 아무것도 저장하지 않는다):
 *   - code 중복
 *   - 필수 필드 존재
 *   - level 유효성
 *   - parent_code 존재 (파일 내 또는 DB)
 *   - 계층 관계: sido는 parent 없음 / sigungu의 parent는 sido /
 *     eupmyeondong의 parent는 sigungu 또는 sido(세종시 등 시군구 없는 구조)
 */
import fs from "node:fs";
import path from "node:path";

const LEVELS = new Set(["sido", "sigungu", "eupmyeondong"]);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const ci = { code: idx("code"), name: idx("name"), level: idx("level"), parent: idx("parent_code"), cur: idx("is_current") };
  if (ci.code < 0 || ci.name < 0 || ci.level < 0) {
    throw new Error("CSV 헤더에 code,name,level이 필요합니다.");
  }
  return lines.slice(1).map((line) => {
    const c = line.split(",").map((v) => v.trim());
    return {
      code: c[ci.code],
      name: c[ci.name],
      level: c[ci.level],
      parent_code: ci.parent >= 0 && c[ci.parent] ? c[ci.parent] : null,
      is_current: ci.cur >= 0 ? c[ci.cur] !== "0" : true,
    };
  });
}

function loadRows(file) {
  const text = fs.readFileSync(file, "utf8");
  if (path.extname(file).toLowerCase() === ".json") {
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) throw new Error("JSON은 배열이어야 합니다.");
    return raw.map((r) => ({
      code: String(r.code ?? "").trim(),
      name: String(r.name ?? "").trim(),
      level: String(r.level ?? "").trim(),
      parent_code: r.parent_code ? String(r.parent_code).trim() : null,
      is_current: r.is_current !== false && r.is_current !== 0,
    }));
  }
  return parseCsv(text);
}

/** 검증 — 오류 목록을 반환한다 (빈 배열이면 통과) */
export function validateRows(rows, existingCodes = new Set()) {
  const errors = [];
  const seen = new Map();

  for (const [i, r] of rows.entries()) {
    const at = `행 ${i + 1} (${r.code || "code 없음"})`;
    if (!r.code) errors.push(`${at}: code가 비어 있습니다.`);
    if (!r.name) errors.push(`${at}: name이 비어 있습니다.`);
    if (!LEVELS.has(r.level)) errors.push(`${at}: level이 올바르지 않습니다 (${r.level}).`);
    if (r.code && seen.has(r.code)) {
      errors.push(`${at}: code가 중복됩니다 (행 ${seen.get(r.code) + 1}과 충돌).`);
    } else if (r.code) {
      seen.set(r.code, i);
    }
  }

  const levelOf = new Map(rows.map((r) => [r.code, r.level]));
  for (const [i, r] of rows.entries()) {
    const at = `행 ${i + 1} (${r.code})`;
    if (r.level === "sido") {
      if (r.parent_code) errors.push(`${at}: 시/도는 parent_code를 가질 수 없습니다.`);
      continue;
    }
    if (!r.parent_code) {
      errors.push(`${at}: ${r.level}은 parent_code가 필요합니다.`);
      continue;
    }
    const parentLevel = levelOf.get(r.parent_code);
    if (!parentLevel && !existingCodes.has(r.parent_code)) {
      errors.push(`${at}: parent_code ${r.parent_code}를 찾을 수 없습니다.`);
      continue;
    }
    if (!parentLevel) continue; // DB에 이미 존재 — level은 DB 제약으로 신뢰

    if (r.level === "sigungu" && parentLevel !== "sido") {
      errors.push(`${at}: 시/군/구의 상위는 시/도여야 합니다 (현재 ${parentLevel}).`);
    }
    if (r.level === "eupmyeondong" && parentLevel !== "sigungu" && parentLevel !== "sido") {
      // 세종특별자치시처럼 시/군/구 단계가 없는 구조는 sido가 상위일 수 있다
      errors.push(`${at}: 읍/면/동의 상위는 시/군/구 또는 시/도여야 합니다 (현재 ${parentLevel}).`);
    }
  }
  return errors;
}

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!file) {
    console.error("사용법: node scripts/import-administrative-areas.mjs <파일.csv|json> [--dry-run]");
    process.exit(1);
  }

  const rows = loadRows(file);
  console.log(`${rows.length}건을 읽었습니다.`);

  const { queryRows, withTransaction } = await import("../src/database/connection.ts");
  const existing = await queryRows("SELECT code FROM administrative_areas");
  const existingCodes = new Set(existing.map((r) => r.code));

  const errors = validateRows(rows, existingCodes);
  if (errors.length > 0) {
    console.error(`검증 실패 ${errors.length}건 — 아무것도 저장하지 않았습니다.`);
    for (const e of errors.slice(0, 30)) console.error(`  - ${e}`);
    if (errors.length > 30) console.error(`  ... 외 ${errors.length - 30}건`);
    process.exit(1);
  }
  console.log("검증 통과.");

  if (dryRun) {
    const byLevel = {};
    for (const r of rows) byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
    console.log("dry-run — 저장하지 않았습니다.", byLevel);
    return;
  }

  // 부분 임포트를 막기 위해 트랜잭션으로 일괄 적용한다.
  // 상위 레벨부터 넣어야 parent FK가 충족된다.
  const order = { sido: 0, sigungu: 1, eupmyeondong: 2 };
  const sorted = [...rows].sort((a, b) => order[a.level] - order[b.level]);

  const repo = await import("../src/database/repositories/region-repository.ts");
  await withTransaction(async () => {
    for (const r of sorted) {
      await repo.upsertArea({
        code: r.code,
        name: r.name,
        level: r.level,
        parentCode: r.parent_code,
        isCurrent: r.is_current,
      });
    }
  });
  console.log(`${rows.length}건을 임포트했습니다.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
