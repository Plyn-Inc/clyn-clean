import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;
  const { session } = guard;
  return NextResponse.json({ session });
}
