import { execute, queryRow, queryRows, withTransaction } from "../connection";

export type AreaLevel = "sido" | "sigungu" | "eupmyeondong";

export interface AdministrativeArea {
  code: string;
  name: string;
  level: AreaLevel;
  parent_code: string | null;
  is_current: number;
  updated_at: string;
}

export interface ServiceArea {
  sigungu_code: string;
  is_enabled: number;
  admin_note: string | null;
  updated_by_admin_id: number | null;
  updated_at: string;
}

/** 행정구역 master가 임포트됐는지 (미임포트 시 관리자 화면에 안내) */
export async function countAreas(): Promise<number> {
  const row = await queryRow<{ c: number }>("SELECT COUNT(*) as c FROM administrative_areas");
  return Number(row?.c ?? 0);
}

export function listByLevel(level: AreaLevel): Promise<AdministrativeArea[]> {
  return queryRows<AdministrativeArea>(
    `SELECT * FROM administrative_areas
      WHERE level = ? AND is_current = 1
      ORDER BY code ASC`,
    [level]
  );
}

/**
 * 하위 행정구역 조회.
 *
 * 세종특별자치시처럼 시/군/구 단계가 없는 경우, sido의 자식이 바로
 * eupmyeondong일 수 있다. parent_code만으로 조회하므로 구조에 관계없이 동작한다.
 */
export function listChildren(parentCode: string): Promise<AdministrativeArea[]> {
  return queryRows<AdministrativeArea>(
    `SELECT * FROM administrative_areas
      WHERE parent_code = ? AND is_current = 1
      ORDER BY code ASC`,
    [parentCode]
  );
}


/** 고객 예약용: 예약 가능으로 체크된 시/군/구가 하나라도 있는 시/도만 반환 */
export function listAvailableSidos(): Promise<AdministrativeArea[]> {
  return queryRows<AdministrativeArea>(
    `SELECT s.*
       FROM administrative_areas s
      WHERE s.level = 'sido'
        AND s.is_current = 1
        AND (
          EXISTS (
            SELECT 1
              FROM service_areas sa
             WHERE sa.sigungu_code = s.code
               AND sa.is_enabled = 1
          )
          OR EXISTS (
            SELECT 1
              FROM administrative_areas g
              JOIN service_areas sa
                ON sa.sigungu_code = g.code
               AND sa.is_enabled = 1
             WHERE g.parent_code = s.code
               AND g.is_current = 1
          )
        )
      ORDER BY s.code ASC`
  );
}

/**
 * 고객 예약용 하위지역 조회.
 * - 시/도 아래에서는 예약 가능으로 체크된 시/군/구만 반환한다.
 * - 세종처럼 시/도 자체가 서비스지역 key인 경우 그 하위 읍/면/동을 반환한다.
 * - 예약 가능한 시/군/구 아래에서는 읍/면/동 전체를 반환한다.
 */
export function listAvailableChildren(parentCode: string): Promise<AdministrativeArea[]> {
  return queryRows<AdministrativeArea>(
    `SELECT child.*
       FROM administrative_areas child
      WHERE child.parent_code = ?
        AND child.is_current = 1
        AND (
          (
            child.level = 'sigungu'
            AND EXISTS (
              SELECT 1
                FROM service_areas sa
               WHERE sa.sigungu_code = child.code
                 AND sa.is_enabled = 1
            )
          )
          OR
          (
            child.level = 'eupmyeondong'
            AND EXISTS (
              SELECT 1
                FROM service_areas sa
               WHERE sa.sigungu_code = ?
                 AND sa.is_enabled = 1
            )
          )
        )
      ORDER BY child.code ASC`,
    [parentCode, parentCode]
  );
}

export function findArea(code: string): Promise<AdministrativeArea | undefined> {
  return queryRow<AdministrativeArea>(
    "SELECT * FROM administrative_areas WHERE code = ?",
    [code]
  );
}

export function upsertArea(area: {
  code: string;
  name: string;
  level: AreaLevel;
  parentCode: string | null;
  isCurrent?: boolean;
}): Promise<void> {
  return execute(
    `INSERT INTO administrative_areas (code, name, level, parent_code, is_current, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name,
       level = EXCLUDED.level,
       parent_code = EXCLUDED.parent_code,
       is_current = EXCLUDED.is_current,
       updated_at = datetime('now')`,
    [area.code, area.name, area.level, area.parentCode, area.isCurrent === false ? 0 : 1]
  );
}

/**
 * 공식 행정구역 master를 원자적으로 교체한다.
 *
 * 기존 행을 삭제하지 않고 is_current=0으로 내려 service_areas FK를 보존한다.
 * 신규/현행 행은 상위 레벨부터 batch upsert한다.
 */
export async function replaceAdministrativeAreaMaster(
  areas: Array<{
    code: string;
    name: string;
    level: AreaLevel;
    parentCode: string | null;
  }>
): Promise<void> {
  const levelOrder: Record<AreaLevel, number> = { sido: 0, sigungu: 1, eupmyeondong: 2 };
  const sorted = [...areas].sort(
    (a, b) => levelOrder[a.level] - levelOrder[b.level] || a.code.localeCompare(b.code)
  );
  const batchSize = 150; // SQLite parameter limit도 넘지 않도록 5 params × 150 = 750

  await withTransaction(async () => {
    await execute("UPDATE administrative_areas SET is_current = 0, updated_at = datetime('now')");

    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      const values = batch.map(() => "(?, ?, ?, ?, 1, datetime('now'))").join(", ");
      const params = batch.flatMap((area) => [area.code, area.name, area.level, area.parentCode]);
      await execute(
        `INSERT INTO administrative_areas (code, name, level, parent_code, is_current, updated_at)
         VALUES ${values}
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name,
           level = EXCLUDED.level,
           parent_code = EXCLUDED.parent_code,
           is_current = 1,
           updated_at = datetime('now')`,
        params
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 서비스 가능지역 (시/군/구 단위)
// ---------------------------------------------------------------------------

export function listServiceAreas(): Promise<(ServiceArea & { name: string | null })[]> {
  return queryRows<ServiceArea & { name: string | null }>(
    `SELECT sa.*, a.name
       FROM service_areas sa
       LEFT JOIN administrative_areas a ON a.code = sa.sigungu_code
      ORDER BY sa.sigungu_code ASC`
  );
}

export async function isServiceArea(sigunguCode: string): Promise<boolean> {
  const row = await queryRow<{ is_enabled: number }>(
    "SELECT is_enabled FROM service_areas WHERE sigungu_code = ?",
    [sigunguCode]
  );
  return row?.is_enabled === 1;
}

/**
 * 고객 직접예약 제출용 서비스지역 상태.
 *
 * 행정구역 master 준비 여부와 선택 시/군/구의 활성 여부를 한 번의 DB 왕복으로
 * 확인한다. master가 비어 있는 상태와 단순 서비스지역 OFF를 구분하면서도
 * countAreas() + isServiceArea() 두 번 조회하지 않는다.
 */
export async function getReservationAreaStatus(sigunguCode: string): Promise<{
  masterReady: boolean;
  serviceEnabled: boolean;
}> {
  const row = await queryRow<{ master_ready: number; service_enabled: number }>(
    `SELECT
       CASE WHEN EXISTS (
         SELECT 1 FROM administrative_areas WHERE is_current = 1 LIMIT 1
       ) THEN 1 ELSE 0 END AS master_ready,
       CASE WHEN EXISTS (
         SELECT 1 FROM service_areas
          WHERE sigungu_code = ? AND is_enabled = 1
       ) THEN 1 ELSE 0 END AS service_enabled`,
    [sigunguCode]
  );
  return {
    masterReady: Number(row?.master_ready ?? 0) === 1,
    serviceEnabled: Number(row?.service_enabled ?? 0) === 1,
  };
}

/** 활성 서비스 지역 코드 집합 */
export async function enabledServiceAreaCodes(): Promise<Set<string>> {
  const rows = await queryRows<{ sigungu_code: string }>(
    "SELECT sigungu_code FROM service_areas WHERE is_enabled = 1"
  );
  return new Set(rows.map((r) => r.sigungu_code));
}

export function setServiceArea(input: {
  sigunguCode: string;
  isEnabled: boolean;
  adminNote?: string | null;
  adminId?: number | null;
}): Promise<void> {
  return execute(
    `INSERT INTO service_areas (sigungu_code, is_enabled, admin_note, updated_by_admin_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT (sigungu_code) DO UPDATE SET
       is_enabled = EXCLUDED.is_enabled,
       admin_note = EXCLUDED.admin_note,
       updated_by_admin_id = EXCLUDED.updated_by_admin_id,
       updated_at = datetime('now')`,
    [input.sigunguCode, input.isEnabled ? 1 : 0, input.adminNote ?? null, input.adminId ?? null]
  );
}
