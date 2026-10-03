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
  assert.match(storage, /storage\/v1\/object\/notice-images/);
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
