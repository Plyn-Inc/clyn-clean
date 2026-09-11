import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  syncSpecialDays,
  syncSpecialDaysIncremental,
  checkCoverage,
  listManualOverrides,
  setManualSpecialDay,
  clearManualSpecialDay,
} from "@/lib/special-days-store";
import { KasiUnavailableError } from "@/lib/kasi";
import { isValidDateFormat } from "@/lib/utils";

/** 동기화 상태 + manual override 목록 */
export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const [coverage, overrides] = await Promise.all([checkCoverage(), listManualOverrides()]);
  return NextResponse.json({ coverage, overrides });
}

/**
 * action=sync    : KASI 동기화 실행 (관리자/배치 트리거 전용)
 * action=manual  : 임시공휴일 등 관리자 수동 지정
 * action=clear   : manual override 해제 (다음 동기화 때 KASI 값 복구)
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "sync") {
    try {
      const result =
        body?.mode === "incremental"
          ? await syncSpecialDaysIncremental()
          : await syncSpecialDays({ force: body?.force === true });
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      if (e instanceof KasiUnavailableError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
      }
      console.error("[special-days] sync 실패", e);
      return NextResponse.json({ error: "동기화 중 오류가 발생했습니다." }, { status: 500 });
    }
  }

  if (action === "manual") {
    const date = String(body?.date ?? "");
    if (!isValidDateFormat(date)) {
      return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
    await setManualSpecialDay({
      date,
      isHoliday: body?.isHoliday === true,
      holidayName: body?.holidayName ? String(body.holidayName) : null,
      isSonEomneunDay: body?.isSonEomneunDay === true,
      adminNote: body?.adminNote ? String(body.adminNote) : undefined,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "clear") {
    const date = String(body?.date ?? "");
    if (!isValidDateFormat(date)) {
      return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
    await clearManualSpecialDay(date);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "알 수 없는 action입니다." }, { status: 400 });
}
