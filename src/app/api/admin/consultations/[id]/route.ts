import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  getConsultationById,
  updateConsultationStatus,
  updateConsultationMemo,
} from "@/lib/consultations";
import type { ConsultationStatus } from "@/lib/types";

const ALLOWED: ConsultationStatus[] = ["received", "contacting", "converted", "closed"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { id } = await ctx.params;
  const consultation = await getConsultationById(Number(id));
  if (!consultation) {
    return NextResponse.json({ error: "상담 접수를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ consultation });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const consultationId = Number(id);

  if (body?.status) {
    if (!ALLOWED.includes(body.status)) {
      return NextResponse.json({ error: "올바르지 않은 상태값입니다." }, { status: 400 });
    }
    await updateConsultationStatus(consultationId, body.status);
  }
  if (typeof body?.memo === "string") {
    await updateConsultationMemo(consultationId, body.memo);
  }
  return NextResponse.json({ ok: true });
}
