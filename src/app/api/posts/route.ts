import { NextResponse } from "next/server";
import { listPosts } from "@/lib/posts";

export async function GET() {
  const posts = await listPosts({ onlyPublished: true });
  return NextResponse.json({ posts });
}
