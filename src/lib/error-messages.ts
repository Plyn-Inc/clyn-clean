/**
 * 고객에게 보여줄 오류 메시지 변환 — 단일 원천.
 *
 * 원칙: fetch 자체가 실패한 경우에만 "네트워크" 문구를 사용한다.
 * 서버가 JSON 오류를 응답한 경우(400/409/500 등)는 네트워크 오류로 뭉뚱그리지 않는다.
 */

/** fetch exception (네트워크 단절, DNS, CORS, timeout 등) */
export const NETWORK_ERROR_MESSAGE =
  "네트워크 연결에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";

/** 서버가 응답했지만 원인을 특정할 수 없는 경우 */
export const SERVER_ERROR_MESSAGE =
  "예약 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";

const CODE_MESSAGES: Record<string, string> = {
  OUT_OF_BOOKING_WINDOW: "예약 가능한 날짜 범위를 벗어났습니다.",
  SPECIAL_DAY_NOT_SYNCED:
    "선택한 날짜의 예약 정보를 준비 중입니다. 잠시 후 다시 확인해주세요.",
  SPECIAL_DAY_UNAVAILABLE:
    "선택한 날짜의 예약 정보를 준비 중입니다. 잠시 후 다시 확인해주세요.",
  SLOT_UNAVAILABLE: "선택한 날짜의 예약이 마감되었습니다. 다른 날짜를 선택해주세요.",
  SLOT_TAKEN: "선택한 날짜의 예약이 마감되었습니다. 다른 날짜를 선택해주세요.",
  DATE_FULLY_BOOKED: "선택한 날짜의 예약이 마감되었습니다. 다른 날짜를 선택해주세요.",
  DATE_NOT_AVAILABLE: "선택한 날짜는 예약할 수 없습니다. 다른 날짜를 선택해주세요.",
  SETTINGS_NOT_READY: "예약 접수 준비 중입니다. 잠시 후 다시 시도해주세요.",
};

export interface ServerErrorBody {
  error?: string;
  code?: string;
  message?: string;
}

/**
 * 서버 JSON 오류 응답을 고객 문구로 변환한다.
 *
 * 1) 알려진 code → 전용 문구
 * 2) 서버가 내려준 error/message(검증 메시지 등) → 그대로 사용
 * 3) 그 외 / 5xx → 일반 서버 오류 문구
 */
export function messageFromServerError(
  status: number,
  body: ServerErrorBody | null | undefined
): string {
  const code = body?.code;
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  // 입력 검증 오류 등 서버가 사용자에게 보여줄 문구를 직접 준 경우
  const serverText = (body?.error ?? body?.message ?? "").trim();
  if (status >= 400 && status < 500 && serverText) return serverText;

  return SERVER_ERROR_MESSAGE;
}

/** fetch 호출 결과를 표준화한다 (네트워크 실패와 서버 오류를 구분) */
export type ApiOutcome<T> =
  | { kind: "success"; data: T; status: number }
  | { kind: "serverError"; status: number; body: ServerErrorBody | null; message: string }
  | { kind: "networkError"; message: string };

export async function callApi<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<ApiOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    // fetch 자체가 실패한 경우에만 네트워크 오류다
    return { kind: "networkError", message: NETWORK_ERROR_MESSAGE };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (res.ok) return { kind: "success", data: body as T, status: res.status };

  const errBody = (body ?? null) as ServerErrorBody | null;
  return {
    kind: "serverError",
    status: res.status,
    body: errBody,
    message: messageFromServerError(res.status, errBody),
  };
}
