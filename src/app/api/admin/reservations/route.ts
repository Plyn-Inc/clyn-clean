import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { listReservations, getDashboardStats } from "@/lib/reservations";
import type { ReservationStatus, PaymentStatus } from "@/lib/types";

export async function GET(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as ReservationStatus | null;
  const paymentStatus = searchParams.get("paymentStatus") as PaymentStatus | null;
  const search = searchParams.get("search");

  const reservations = await listReservations({
    status: status ?? undefined,
    paymentStatus: paymentStatus ?? undefined,
    search: search ?? undefined,
  });
  const stats = await getDashboardStats();

  return NextResponse.json({ reservations, stats });
}
