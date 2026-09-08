import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { listOverdueUnpaidReservations } from "@/lib/reservations";

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const reservations = await listOverdueUnpaidReservations();
  return NextResponse.json({ reservations });
}
