import { getDatabaseBackend } from "./connection";
import { seedAdmin } from "./seed-admin";

/**
 * 관리자 계정 seed를 1회만 수행한다.
 *
 * 서버 부팅(instrumentation)에서 호출하지 않는다.
 * 부팅 경로에서 DB를 기다리면 홈페이지 TTFB가 DB 응답에 묶이기 때문이다.
 * 관리자 로그인 경로에서 lazy하게 호출한다.
 */
let adminSeedPromise: Promise<void> | null = null;

export function ensureAdminSeeded(): Promise<void> {
  if (getDatabaseBackend() === "postgres" && !process.env.DATABASE_URL) {
    return Promise.reject(new Error("DATABASE_URL is required in production."));
  }
  if (!adminSeedPromise) {
    adminSeedPromise = seedAdmin().catch((e) => {
      // 실패하면 다음 호출에서 다시 시도할 수 있게 캐시를 비운다
      adminSeedPromise = null;
      throw e;
    });
  }
  return adminSeedPromise;
}

/** @deprecated 부팅 경로에서 호출하지 마세요. ensureAdminSeeded()를 사용합니다. */
export const ensureDatabaseReady = ensureAdminSeeded;

export * from "./connection";
