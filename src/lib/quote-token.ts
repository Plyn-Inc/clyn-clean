/**
 * 서버 발급 견적 snapshot + HMAC 서명 토큰.
 */
import crypto from "node:crypto";

export const QUOTE_TOKEN_TTL_MS = 30 * 60 * 1000;
export const QUOTE_TOKEN_VERSION = 1;

export interface QuoteSnapshot {
  schemaVersion: number;
  quoteId: string;
  serviceType: string;
  productKey: string | null;
  desiredDate: string | null;
  timeSlot: string | null;
  areaSidoCode: string | null;
  areaSigunguCode: string | null;
  areaDongCode: string | null;
  basePrice: number;
  holidaySurcharge: number;
  dateAdjustmentAmount: number;
  originalAmount: number;
  automaticDiscount: number;
  promotionName: string | null;
  couponDiscount: number;
  promotionId: number | null;
  couponId: number | null;
  couponCode: string | null;
  estimatedTotal: number;
  depositAmount: number;
  estimatedBalance: number;
  issuedAt: number;
  expiresAt: number;
}

const CANONICAL_KEYS: (keyof QuoteSnapshot)[] = [
  "schemaVersion", "quoteId",
  "serviceType", "productKey", "desiredDate", "timeSlot",
  "areaSidoCode", "areaSigunguCode", "areaDongCode",
  "basePrice", "holidaySurcharge", "dateAdjustmentAmount",
  "originalAmount", "automaticDiscount", "couponDiscount",
  "promotionId", "promotionName", "couponId", "couponCode",
  "estimatedTotal", "depositAmount", "estimatedBalance",
  "issuedAt", "expiresAt",
];

function canonicalize(s: QuoteSnapshot): string {
  const ordered: Record<string, unknown> = {};
  for (const k of CANONICAL_KEYS) ordered[k] = s[k] ?? null;
  return JSON.stringify(ordered);
}

export class QuoteTokenError extends Error {
  code: string;
  constructor(message: string, code = "QUOTE_INVALID") {
    super(message);
    this.name = "QuoteTokenError";
    this.code = code;
  }
}

const MIN_SECRET_BYTES = 32;
const QUOTE_KEY_DOMAIN = "clyn-quote-token-v1";

/**
 * 견적 서명키는 QUOTE_TOKEN_SECRET을 최우선으로 사용한다.
 * 운영환경에 전용 키가 아직 없더라도 기존 JWT_SECRET에서 domain-separated
 * 32-byte HMAC 키를 파생해 견적 발급 자체가 중단되지 않게 한다.
 * 파생키는 JWT 서명키 원문과 다르므로 토큰 용도 간 키를 직접 재사용하지 않는다.
 */
function secret(): string {
  const dedicated = process.env.QUOTE_TOKEN_SECRET?.trim();
  if (dedicated && Buffer.byteLength(dedicated, "utf8") >= MIN_SECRET_BYTES) return dedicated;

  const jwt = process.env.JWT_SECRET?.trim();
  if (jwt && Buffer.byteLength(jwt, "utf8") >= 16) {
    return crypto.createHmac("sha256", jwt).update(QUOTE_KEY_DOMAIN).digest("hex");
  }

  throw new QuoteTokenError("견적 서명 키가 설정되지 않았습니다.", "QUOTE_SECRET_MISSING");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
}

export function issueQuoteToken(
  snapshot: Omit<QuoteSnapshot, "issuedAt" | "expiresAt" | "schemaVersion" | "quoteId"> & { quoteId?: string }
): { token: string; snapshot: QuoteSnapshot } {
  const issuedAt = Date.now();
  const full: QuoteSnapshot = {
    ...snapshot,
    quoteId: snapshot.quoteId ?? crypto.randomUUID(),
    schemaVersion: QUOTE_TOKEN_VERSION,
    issuedAt,
    expiresAt: issuedAt + QUOTE_TOKEN_TTL_MS,
  };
  const payload = b64url(Buffer.from(canonicalize(full), "utf8"));
  return { token: `v${QUOTE_TOKEN_VERSION}.${payload}.${sign(payload)}`, snapshot: full };
}

export function verifyQuoteToken(token: string | undefined | null): QuoteSnapshot {
  if (!token || typeof token !== "string") {
    throw new QuoteTokenError("견적 정보가 없습니다. 새로고침 후 다시 시도해주세요.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new QuoteTokenError("견적 정보가 올바르지 않습니다.", "QUOTE_TAMPERED");
  }
  const [version, payload, mac] = parts;
  if (version !== `v${QUOTE_TOKEN_VERSION}`) {
    throw new QuoteTokenError("견적 형식이 변경되었습니다. 새로고침 후 다시 시도해주세요.", "QUOTE_VERSION_MISMATCH");
  }

  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new QuoteTokenError("견적 정보가 올바르지 않습니다. 새로고침 후 다시 시도해주세요.", "QUOTE_TAMPERED");
  }

  let snapshot: QuoteSnapshot;
  try {
    snapshot = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    throw new QuoteTokenError("견적 정보를 해석할 수 없습니다.", "QUOTE_TAMPERED");
  }

  if (Date.now() > snapshot.expiresAt) {
    throw new QuoteTokenError("견적 유효시간이 지났습니다. 새로고침 후 다시 시도해주세요.", "QUOTE_EXPIRED");
  }
  return snapshot;
}

export interface QuoteSubjectRequest {
  serviceType: string;
  productKey: string | null | undefined;
  desiredDate: string | null | undefined;
  timeSlot: string | null | undefined;
  areaSidoCode?: string | null;
  areaSigunguCode?: string | null;
  areaDongCode?: string | null;
}

export function assertSnapshotMatchesRequest(snapshot: QuoteSnapshot, req: QuoteSubjectRequest): void {
  const norm = (v: string | null | undefined) => (v === undefined || v === "" ? null : v);
  const checks: [string, unknown, unknown][] = [
    ["serviceType", snapshot.serviceType, req.serviceType],
    ["productKey", snapshot.productKey, norm(req.productKey)],
    ["desiredDate", norm(snapshot.desiredDate), norm(req.desiredDate)],
    ["timeSlot", norm(snapshot.timeSlot), norm(req.timeSlot)],
    ["areaSidoCode", norm(snapshot.areaSidoCode), norm(req.areaSidoCode)],
    ["areaSigunguCode", norm(snapshot.areaSigunguCode), norm(req.areaSigunguCode)],
    ["areaDongCode", norm(snapshot.areaDongCode), norm(req.areaDongCode)],
  ];
  for (const [field, expected, actual] of checks) {
    if (expected !== actual) {
      throw new QuoteTokenError("예약 조건이 변경되었습니다. 새로고침 후 다시 시도해주세요.", "QUOTE_MISMATCH");
    }
    void field;
  }
}
