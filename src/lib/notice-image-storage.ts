const NOTICE_IMAGE_BUCKET = "notice-images";
export const NOTICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function validateNoticeImageMeta(meta: { type: string; size: number }): void {
  if (!EXTENSION_BY_MIME[meta.type]) {
    throw new Error("팝업 이미지는 PNG, JPG(JPEG), WebP 형식만 업로드할 수 있습니다.");
  }
  if (!Number.isFinite(meta.size) || meta.size < 0) {
    throw new Error("이미지 용량을 확인해주세요.");
  }
  if (meta.size > NOTICE_IMAGE_MAX_BYTES) {
    throw new Error("팝업 이미지는 5MB 이하만 업로드할 수 있습니다.");
  }
}

export function createNoticeImageObjectPath(type: string): string {
  const ext = EXTENSION_BY_MIME[type];
  if (!ext) {
    throw new Error("지원하지 않는 이미지 형식입니다.");
  }
  return `popup/${crypto.randomUUID()}.${ext}`;
}

function requiredServerUrl(): string {
  const value = process.env.SUPABASE_URL?.trim();
  if (!value) throw new Error("SUPABASE_URL 환경변수가 설정되지 않았습니다.");
  return value.replace(/\/+$/, "");
}

function requiredSecretEnv(): string {
  const value = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!value) throw new Error("SUPABASE_SECRET_KEY 환경변수가 설정되지 않았습니다.");
  return value;
}

export async function uploadNoticeImage(file: File): Promise<{ url: string; path: string }> {
  validateNoticeImageMeta({ type: file.type, size: file.size });

  const baseUrl = requiredServerUrl();
  const secret = requiredSecretEnv();
  const path = createNoticeImageObjectPath(file.type);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const uploadUrl = `${baseUrl}/storage/v1/object/${NOTICE_IMAGE_BUCKET}/${encodedPath}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": file.type,
      "Cache-Control": "3600",
    },
    body: await file.arrayBuffer(),
    cache: "no-store",
  });

  if (!response.ok) {
    console.error(`[notice-image] upload failed status=${response.status}`);
    throw new Error("이미지 저장소 업로드에 실패했습니다.");
  }

  return {
    path,
    url: `${baseUrl}/storage/v1/object/public/${NOTICE_IMAGE_BUCKET}/${encodedPath}`,
  };
}
