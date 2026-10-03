import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => {
  const full = path.join(root, p);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
};

const migration = read("supabase/migrations/20261003120000_notice_image_popup.sql");
const schema = read("src/database/schema.ts");
const repo = read("src/database/repositories/notice-repository.ts");
const noticesSource = read("src/lib/notices.ts");
const createRoute = read("src/app/api/admin/notices/route.ts");
const updateRoute = read("src/app/api/admin/notices/[id]/route.ts");

test("공지 이미지 팝업 스키마는 PostgreSQL과 SQLite에 동일한 컬럼을 추가한다", () => {
  assert.match(migration, /popup_image_url\s+TEXT/i);
  assert.match(migration, /popup_link_url\s+TEXT/i);
  assert.match(schema, /ALTER TABLE notices ADD COLUMN popup_image_url TEXT/);
  assert.match(schema, /ALTER TABLE notices ADD COLUMN popup_link_url TEXT/);
});

test("공지 repository는 이미지 URL과 링크 URL을 생성/수정에서 왕복 저장한다", () => {
  assert.match(repo, /popup_image_url:\s*string\s*\|\s*null/);
  assert.match(repo, /popup_link_url:\s*string\s*\|\s*null/);
  assert.match(repo, /popupImageUrl:\s*string\s*\|\s*null/);
  assert.match(repo, /popupLinkUrl:\s*string\s*\|\s*null/);
  assert.match(repo, /popup_image_url,\s*popup_link_url/);
  assert.match(repo, /input\.popupImageUrl/);
  assert.match(repo, /input\.popupLinkUrl/);
});

test("공개 공지 DTO와 Admin create/update API가 이미지와 링크 필드를 전달한다", () => {
  assert.match(noticesSource, /popupImageUrl:\s*string\s*\|\s*null/);
  assert.match(noticesSource, /popupLinkUrl:\s*string\s*\|\s*null/);
  assert.match(noticesSource, /popupImageUrl:\s*row\.popup_image_url/);
  assert.match(noticesSource, /popupLinkUrl:\s*row\.popup_link_url/);
  for (const route of [createRoute, updateRoute]) {
    assert.match(route, /popupImageUrl/);
    assert.match(route, /popupLinkUrl/);
    assert.match(route, /normalizePopupLinkUrl/);
  }
});

test("popup 링크 정규화는 내부 경로와 http(s)만 허용한다", async () => {
  const mod = await import("../src/lib/notices.ts");
  assert.equal(mod.normalizePopupLinkUrl("/reservation"), "/reservation");
  assert.equal(mod.normalizePopupLinkUrl(" https://example.com/x "), "https://example.com/x");
  assert.equal(mod.normalizePopupLinkUrl(""), null);
  assert.equal(mod.normalizePopupLinkUrl(null), null);
});

test("popup 링크 정규화는 위험하거나 모호한 URL을 거부한다", async () => {
  const mod = await import("../src/lib/notices.ts");
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "//evil.example",
    "mailto:test@example.com",
  ]) {
    assert.throws(() => mod.normalizePopupLinkUrl(value), /링크|URL|주소/);
  }
});


test("공지 이미지 업로드 검증은 MIME과 5MB 제한을 적용한다", async () => {
  const mod = await import("../src/lib/notice-image-storage.ts");
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.doesNotThrow(() => mod.validateNoticeImageMeta({ type, size: 5 * 1024 * 1024 }));
  }
  for (const type of ["image/gif", "text/plain", "application/octet-stream"]) {
    assert.throws(() => mod.validateNoticeImageMeta({ type, size: 1 }), /PNG|JPG|JPEG|WebP|이미지/);
  }
  assert.throws(
    () => mod.validateNoticeImageMeta({ type: "image/png", size: 5 * 1024 * 1024 + 1 }),
    /5MB|용량/
  );
});

test("공지 이미지 업로드는 원본 파일명을 재사용하지 않고 popup 고유 경로를 만든다", async () => {
  const mod = await import("../src/lib/notice-image-storage.ts");
  const a = mod.createNoticeImageObjectPath("image/png");
  const b = mod.createNoticeImageObjectPath("image/png");
  assert.match(a, /^popup\/[0-9a-f-]+\.png$/);
  assert.match(b, /^popup\/[0-9a-f-]+\.png$/);
  assert.notEqual(a, b);
});

test("공지 이미지 Storage helper는 서버 전용 secret만 사용한다", () => {
  const storage = read("src/lib/notice-image-storage.ts");
  assert.match(storage, /process\.env\.SUPABASE_URL/);
  assert.match(storage, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(storage, /NEXT_PUBLIC_.*SECRET|NEXT_PUBLIC_SUPABASE_SECRET/);
  assert.match(storage, /notice-images/);
  assert.match(storage, /NOTICE_IMAGE_BUCKET = "notice-images"/);
  assert.match(storage, /storage\\/v1\\/object\\/\$\{NOTICE_IMAGE_BUCKET\}/);
  assert.doesNotMatch(storage, /upsert\s*:\s*true|x-upsert[^\n]*true/i);
});

test("공지 이미지 업로드 API는 관리자 세션 확인 후 multipart file을 처리한다", () => {
  const route = read("src/app/api/admin/notices/upload-image/route.ts");
  assert.match(route, /requireAdminApiSession\(\)/);
  assert.match(route, /formData\(\)/);
  assert.match(route, /form\.get\(["']file["']\)/);
  assert.match(route, /uploadNoticeImage/);
  assert.match(route, /status:\s*413/);
});


test("Admin 공지 화면은 이미지 업로드 미리보기 제거 링크 저장을 지원한다", () => {
  const page = read("src/app/admin/(protected)/notices/page.tsx");
  assert.match(page, /popup_image_url/);
  assert.match(page, /popup_link_url/);
  assert.match(page, /popupImageUrl/);
  assert.match(page, /popupLinkUrl/);
  assert.match(page, /type=["']file["']/);
  assert.match(page, /accept=.*image\/png.*image\/jpeg.*image\/webp/s);
  assert.match(page, /\/api\/admin\/notices\/upload-image/);
  assert.match(page, /<img[^>]+src=\{form\.popupImageUrl\}/s);
  assert.match(page, /이미지 제거/);
  assert.match(page, /이미지 클릭 링크/);
  assert.match(page, /이미지 팝업/);
});


test("홈페이지 팝업은 이미지가 있으면 이미지형으로 분기하고 기존 제어를 유지한다", () => {
  const popup = read("src/components/NoticePopup.tsx");
  assert.match(popup, /popupImageUrl:\s*string\s*\|\s*null/);
  assert.match(popup, /popupLinkUrl:\s*string\s*\|\s*null/);
  assert.match(popup, /notice\.popupImageUrl/);
  assert.match(popup, /alt=\{notice\.title\}/);
  assert.match(popup, /max-h-\[85vh\]|max-h-\[80vh\]/);
  assert.match(popup, /max-w-\[(500|520|540|550)px\]|max-w-lg/);
  assert.match(popup, /notice\.popupLinkUrl/);
  assert.match(popup, /24시간 보지 않기/);
  assert.match(popup, /닫기/);
  assert.match(popup, /자세히 보기/);
  assert.match(popup, /requestIdleCallback|setTimeout\(startLoad/);
});


test("Supabase secret key는 URL 정규화처럼 값을 변경하지 않는다", () => {
  const storage = read("src/lib/notice-image-storage.ts");
  assert.match(storage, /function requiredSecretEnv|const secret = requiredSecretEnv/);
  assert.doesNotMatch(storage, /SUPABASE_SECRET_KEY[\s\S]{0,200}replace\(\/\\\/\+\$\//);
});


test("팝업 닫기와 24시간 보지 않기 계약을 유지한다", () => {
  const popup = read("src/components/NoticePopup.tsx");
  assert.match(popup, /닫기/);
  assert.match(popup, /24시간 보지 않기/);
  assert.match(popup, /24 \* 60 \* 60 \* 1000/);
  assert.match(popup, /Date\.now\(\) \+ HIDE_DURATION_MS/);
  assert.match(popup, /Number\(stored\) > Date\.now\(\)/);
});


test("모바일 이미지 팝업은 화면을 과도하게 차지하지 않는다", () => {
  const popup = read("src/components/NoticePopup.tsx");
  assert.match(popup, /w-\[82vw\]/);
  assert.match(popup, /max-w-\[360px\]/);
  assert.match(popup, /max-h-\[58vh\]/);
  assert.match(popup, /sm:w-full/);
  assert.match(popup, /sm:max-w-\[540px\]/);
  assert.match(popup, /sm:max-h-\[70vh\]/);
});
