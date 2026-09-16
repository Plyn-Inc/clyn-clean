/**
 * 서버 오류 관측성 — stage / SQLSTATE / 소요시간 / requestId 기록.
 *
 * 원칙:
 *   - 개인정보(이름·연락처·주소)와 DB 접속정보는 절대 로그하지 않는다.
 *   - 오류를 삼키지 않는다. 호출부가 판단할 수 있도록 원본을 그대로 반환/전파한다.
 *   - 로그만 보고 "어느 단계에서, 어떤 SQLSTATE로, 몇 ms 만에" 실패했는지 알 수 있어야 한다.
 */

/** 요청 단위 상관관계 ID */
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface StageFailure {
  stage: string;
  code: string;
  durationMs: number;
  requestId: string;
  message: string;
}

/** 오류에서 SQLSTATE 또는 애플리케이션 코드를 추출한다 */
export function errorCode(e: unknown): string {
  const err = e as { code?: string; name?: string } | null;
  return String(err?.code ?? err?.name ?? "UNKNOWN");
}

/**
 * 한 단계를 계측하며 실행한다.
 *
 * 성공하면 결과를 그대로 반환하고, 실패하면 구조화 로그를 남긴 뒤 다시 던진다.
 * (오류를 숨기지 않는다 — 격리는 호출부의 책임이다)
 */
export async function withStage<T>(
  scope: string,
  stage: string,
  requestId: string,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - started;
    if (ms >= 1000) {
      console.warn(`[${scope}] stage=${stage} slow durationMs=${ms} requestId=${requestId}`);
    }
    return result;
  } catch (e) {
    const ms = Date.now() - started;
    console.error(
      `[${scope}] stage=${stage} FAILED code=${errorCode(e)} durationMs=${ms} requestId=${requestId}`
    );
    throw e;
  }
}

/**
 * 실패해도 화면 전체를 죽이지 않아야 하는 위젯용.
 *
 * 실패 시 구조화 로그를 남기고 fallback 값을 반환한다.
 * 어떤 위젯이 실패했는지 호출부가 알 수 있도록 ok 플래그를 함께 준다.
 */
export async function safeStage<T>(
  scope: string,
  stage: string,
  requestId: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<{ ok: true; data: T } | { ok: false; data: T; failure: StageFailure }> {
  const started = Date.now();
  try {
    const data = await withStage(scope, stage, requestId, fn);
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      data: fallback,
      failure: {
        stage,
        code: errorCode(e),
        durationMs: Date.now() - started,
        requestId,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}
