import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import {
  NOTICE_IMAGE_MAX_BYTES,
  uploadNoticeImage,
  validateNoticeImageMeta,
} from "@/lib/notice-image-storage";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 이미지 파일을 선택해주세요." }, { status: 400 });
  }

  if (file.size > NOTICE_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "팝업 이미지는 5MB 이하만 업로드할 수 있습니다." }, { status: 413 });
  }

  try {
    validateNoticeImageMeta({ type: file.type, size: file.size });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "이미지 파일을 확인해주세요." },
      { status: 400 }
    );
  }

  try {
    const uploaded = await uploadNoticeImage(file);
    return NextResponse.json({ ok: true, url: uploaded.url }, { status: 201 });
  } catch (e) {
    console.error(
      `[notice-image] api upload failed code=${(e as { code?: string })?.code ?? "UNKNOWN"}`
    );
    return NextResponse.json({ error: "이미지 업로드에 실패했습니다." }, { status: 502 });
  }
}
