/**
 * SITE_URL 중앙 관리 유틸
 *
 * 환경변수 정책:
 *   - production build:   SITE_URL 필수. 없거나 잘못된 URL이면 빌드 실패
 *   - production runtime: SITE_URL 필수. 없거나 잘못된 URL이면 에러 throw
 *   - development:        SITE_URL 없으면 http://localhost:3000 fallback 허용
 *   - test:               SITE_URL 없으면 http://localhost:3000 fallback 허용
 *
 * 목적:
 *   이 파일 한 곳에서만 SITE_URL 정책을 관리합니다.
 *   layout.tsx, robots.ts, sitemap.ts 등 호출하는 쪽은 정책을 신경 쓸 필요 없습니다.
 */

const DEV_FALLBACK = "http://localhost:3000";
const CLYN_CANONICAL_ORIGIN = "https://clyncleancare.kr";
const CLYN_HOSTS = new Set(["clyncleancare.kr", "www.clyncleancare.kr"]);

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function canonicalizeKnownHost(url: string): string {
  const parsed = new URL(url);
  if (CLYN_HOSTS.has(parsed.hostname.toLowerCase())) {
    return CLYN_CANONICAL_ORIGIN;
  }
  return normalize(url);
}

/**
 * SITE_URL 환경변수를 읽어 정규화된 origin을 반환합니다.
 * CLYN 운영 도메인은 www/http 값이 들어와도 단일 canonical origin으로 고정합니다.
 */
export function getSiteUrl(): string {
  const raw = process.env.SITE_URL;
  const isProduction = process.env.NODE_ENV === "production";

  if (!raw || raw.trim() === "") {
    if (isProduction) {
      throw new Error(
        "[moving-clean] 운영 환경에서 SITE_URL이 설정되지 않았습니다.\n" +
        "  .env 또는 호스팅 환경변수에 SITE_URL=https://clyncleancare.kr 을 추가하세요."
      );
    }
    return DEV_FALLBACK;
  }

  const normalized = normalize(raw);

  if (!isValidHttpUrl(normalized)) {
    if (isProduction) {
      throw new Error(
        "[moving-clean] SITE_URL이 유효한 http/https URL이 아닙니다.\n" +
        `  입력값: "${normalized}"\n` +
        "  올바른 형식: SITE_URL=https://clyncleancare.kr"
      );
    }
    console.warn(
      `[moving-clean] SITE_URL 값("${normalized}")이 유효하지 않아 ${DEV_FALLBACK}으로 fallback합니다.`
    );
    return DEV_FALLBACK;
  }

  return canonicalizeKnownHost(normalized);
}

export const getSiteOrigin = getSiteUrl;

export function buildAbsoluteUrl(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  const base = getSiteUrl();
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${base}${normalized}`;
}

export function toAbsoluteImageUrl(url: string | null | undefined): string | null {
  if (!url || url.trim() === "") return null;
  return buildAbsoluteUrl(url);
}
