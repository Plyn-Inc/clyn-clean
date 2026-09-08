import { NextResponse } from "next/server";
import { listReviews } from "@/lib/reviews";

export async function GET() {
  const reviews = await listReviews({ onlyPublished: true });
  return NextResponse.json({ reviews });
}
