import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { updateAdminMemo } from "@/lib/reservations";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (typeof body?.memo !== "string") {
    return NextResponse.json({ error: "메모 내용이 필요합니다." }, { status: 400 });
  }

  await updateAdminMemo(Number(id), body.memo);
  return NextResponse.json({ ok: true });
}
