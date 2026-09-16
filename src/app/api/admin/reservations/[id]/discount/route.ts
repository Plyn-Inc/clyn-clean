import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { applyAdminDiscount, AdminDiscountError } from "@/lib/reservations";
import { z } from "zod";

const schema = z.object({
  discountType: z.enum(["fixed", "percent"]),
  discountValue: z.number().int().positive("할인값을 입력해주세요."),
  reason: z.string().trim().min(1, "할인 사유를 입력해주세요.").max(300),
});

/** 관리자 수동 할인 — 예약 생성 이후 마지막 adjustment */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요.", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  try {
    const result = await applyAdminDiscount({
      reservationId: Number(id),
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      reason: parsed.data.reason,
      adminId: session.adminId,
      adminName: session.name ?? "관리자",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof AdminDiscountError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error(`[admin-discount] code=${(e as { code?: string })?.code ?? "UNKNOWN"}`);
    return NextResponse.json({ error: "할인 적용 중 오류가 발생했습니다." }, { status: 500 });
  }
}
