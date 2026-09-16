/**
 * 서버 발급 견적 snapshot + HMAC 서명 토큰.
 *
 * 설계 의도:
 *   - 예약 제출 시 가격을 다시 계산하지 않는다 (단순·빠른 접수 경로 유지)
 *   - 그렇다고 브라우저가 보낸 금액을 그대로 믿지도 않는다
 *   → /api/quote가 계산 결과를 snapshot으로 만들고 서버 secret으로 서명한다.
 *     예약 제출은 서명과 만료만 검증하고, 통과하면 snapshot을 그대로 저장한다.
 *
 * "허용 오차" 같은 느슨한 판정은 쓰지 않는다. 서명이 맞거나 틀리거나 둘 중 하나다.
 * 쿠폰·자동할인이 붙어도 동일 구조를 그대로 사용한다.
 * 관리자 수동 할인은 예약 생성 이후 별도 adjustment로 기록한다.
 */
import crypto from "node:crypto";

/** 견적 유효시간 — 고객이 폼을 채우는 동안 충분하되 가격표 변경을 오래 끌지 않는다 */
export const QUOTE_TOKEN_TTL_MS = 30 * 60 * 1000;

/** 토큰 포맷 버전 — 필드가 바뀌면 올린다 */
export const QUOTE_TOKEN_VERSION = 1;

/**
 * 견적 subject.
 *
 * 금액뿐 아니라 **가격을 결정한 입력 조건 전부**를 서명 대상에 넣는다.
 * 같은 금액이 나왔더라도 예약 조건이 다르면 같은 토큰으로 취급하지 않는다.
 * (예: 평일 견적 토큰을 공휴일 예약에 재사용하는 것을 막는다)
 */
export interface QuoteSnapshot {
  schemaVersion: number;
  /**
   * 견적 고유 ID (UUID).
   *
   * 예약 제출 idempotency 키로 쓴다. 같은 quoteId로 재요청이 오면
   * 새 예약을 만들지 않고 기존 예약 결과를 반환한다.
   * HMAC subject에 포함되므로 위조할 수 없다.
   */
  quoteId: string;
  // --- 가격 결정 입력 ---
  serviceType: string;
  productKey: string | null;
  desiredDate: string | null;
  timeSlot: string | null;
  areaSidoCode: string | null;
  areaSigunguCode: string | null;
  areaDongCode: string | null;
  // --- 금액 구성 ---
  basePrice: number;
  /** 일요일/공휴일 휴일 가산금 */
  holidaySurcharge: number;
  /** 날짜 조건 보정액 (현재는 holidaySurcharge와 동일 원천) */
  dateAdjustmentAmount: number;
  /** 할인 전 정상가 */
  originalAmount: number;
  /** 자동 프로모션 할인액 */
  automaticDiscount: number;
  /** 적용된 프로모션 이름 (snapshot 보존용) */
  promotionName: string | null;
  /** 쿠폰 할인액 */
  couponDiscount: number;
  /** 적용된 프로모션/쿠폰 식별자 (snapshot 보존용) */
  promotionId: number | null;
  couponId: number | null;
  couponCode: string | null;
  estimatedTotal: number;
  depositAmount: number;
  estimatedBalance: number;
  // --- 발급 정보 ---
  issuedAt: number;
  expiresAt: number;
}

/**
 * canonical serialization.
 *
 * 속성 순서 때문에 서명이 달라지지 않도록 키를 고정 순서로 직렬화한다.
 * 필드를 추가하면 이 목록에도 반드시 추가해야 한다 (누락 시 서명 대상에서 빠진다).
 */
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

/** 최소 secret 길이 (바이트) */
const MIN_SECRET_BYTES = 32;

/**
 * 견적 서명 전용 secret.
 *
 * QUOTE_TOKEN_SECRET을 사용한다. 서버 전용이며 클라이언트에 노출하지 않는다
 * (NEXT_PUBLIC_ 접두사를 쓰지 않는 이유).
 * production에서 미설정이거나 짧으면 fail closed — 견적 토큰을 발급하지 않는다.
 */
function secret(): string {
  const s = process.env.QUOTE_TOKEN_SECRET?.trim();
  if (s && Buffer.byteLength(s, "utf8") >= MIN_SECRET_BYTES) return s;

  if (process.env.NODE_ENV === "production") {
    throw new QuoteTokenError(
      "견적 서명 키가 설정되지 않았습니다.",
      "QUOTE_SECRET_MISSING"
    );
  }
  // 개발/테스트에서만 JWT_SECRET으로 대체할 수 있다.
  const dev = process.env.JWT_SECRET?.trim();
  if (dev && Buffer.byteLength(dev, "utf8") >= 16) return dev;
  throw new QuoteTokenError("견적 서명 키가 설정되지 않았습니다.", "QUOTE_SECRET_MISSING");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
}

/** 견적 snapshot을 서명 토큰으로 발급한다 */
export function issueQuoteToken(
  snapshot: Omit<QuoteSnapshot, "issuedAt" | "expiresAt" | "schemaVersion" | "quoteId"> & { quoteId?: string }
): { token: string; snapshot: QuoteSnapshot } {
  const issuedAt = Date.now();
  const full: QuoteSnapshot = {
    ...snapshot,
    // 견적마다 새 UUID. 같은 견적으로 두 번 제출해도 예약은 1건이다.
    quoteId: snapshot.quoteId ?? crypto.randomUUID(),
    schemaVersion: QUOTE_TOKEN_VERSION,
    issuedAt,
    expiresAt: issuedAt + QUOTE_TOKEN_TTL_MS,
  };
  const payload = b64url(Buffer.from(canonicalize(full), "utf8"));
  return { token: `v${QUOTE_TOKEN_VERSION}.${payload}.${sign(payload)}`, snapshot: full };
}

/**
 * 토큰을 검증하고 snapshot을 반환한다.
 *
 * 서명 불일치(변조) 또는 만료면 예외를 던진다.
 * 금액을 다시 계산하지 않는다 — 서명이 무결성을 보장한다.
 */
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
    throw new QuoteTokenError(
      "견적 형식이 변경되었습니다. 새로고침 후 다시 시도해주세요.",
      "QUOTE_VERSION_MISMATCH"
    );
  }

  const expected = sign(payload);
  // 타이밍 공격 방지를 위해 상수 시간 비교
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new QuoteTokenError(
      "견적 정보가 올바르지 않습니다. 새로고침 후 다시 시도해주세요.",
      "QUOTE_TAMPERED"
    );
  }

  let snapshot: QuoteSnapshot;
  try {
    snapshot = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    throw new QuoteTokenError("견적 정보를 해석할 수 없습니다.", "QUOTE_TAMPERED");
  }

  if (Date.now() > snapshot.expiresAt) {
    throw new QuoteTokenError(
      "견적 유효시간이 지났습니다. 새로고침 후 다시 시도해주세요.",
      "QUOTE_EXPIRED"
    );
  }
  return snapshot;
}

/** 예약 요청의 서비스/상품이 토큰 snapshot과 같은지 확인한다 */
export interface QuoteSubjectRequest {
  serviceType: string;
  productKey: string | null | undefined;
  desiredDate: string | null | undefined;
  timeSlot: string | null | undefined;
  areaSidoCode?: string | null;
  areaSigunguCode?: string | null;
  areaDongCode?: string | null;
}

/**
 * 예약 요청이 토큰 subject와 완전히 같은 조건인지 확인한다.
 *
 * 하나라도 다르면 QUOTE_MISMATCH. 따라서 다른 날짜/시간대/지역/상품으로 발급된
 * 견적 토큰을 재사용할 수 없다.
 */
export function assertSnapshotMatchesRequest(
  snapshot: QuoteSnapshot,
  req: QuoteSubjectRequest
): void {
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
      throw new QuoteTokenError(
        "예약 조건이 변경되었습니다. 새로고침 후 다시 시도해주세요.",
        "QUOTE_MISMATCH"
      );
    }
    void field;
  }
}
