import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { listConsultations } from "@/lib/consultations";
import type { ConsultationStatus } from "@/lib/types";

export async function GET(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as ConsultationStatus | null;
  const consultations = await listConsultations(status ? { status } : undefined);
  return NextResponse.json({ consultations });
}
