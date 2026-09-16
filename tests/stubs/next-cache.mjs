/**
 * next/cache 테스트 스텁.
 *
 * Node ESM 로더는 `next/cache`(확장자 없음)를 해석하지 못한다.
 * 테스트에서는 캐시 무효화가 관심사가 아니므로 no-op으로 대체하고,
 * unstable_cache는 원 함수를 그대로 호출해 실제 DB 경로를 검증한다.
 */
export function revalidateTag() {}
export function revalidatePath() {}
export function unstable_cache(fn) {
  return fn;
}
