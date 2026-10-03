# Notice Image Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow CLYN Admin to upload an optional notice/popup image with an optional click URL, then render image-first popups responsively while preserving all existing text notice behavior.

**Architecture:** Extend the existing `notices` model with image/link fields, store popup images in a public Supabase Storage bucket through an admin-authenticated server route, and keep the current popup selection API as the single public read path. The Admin page uploads first, stores the returned public URL in the notice record, and the public popup component chooses image mode only when `popupImageUrl` is present.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, PostgreSQL/Supabase, SQLite regression adapter, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-03-notice-image-popup-design.md`

## Global Constraints

- Existing text notices and text popups must keep working unchanged when `popup_image_url` is NULL.
- Storage bucket: `notice-images`; object prefix: `popup/`.
- Accepted MIME types: `image/png`, `image/jpeg`, `image/webp`.
- Maximum upload size: 5MB.
- Browser must never receive a Supabase secret/service-role key.
- Upload route must require the existing `requireAdminApiSession()` guard.
- Popup links may be empty, an internal path beginning with `/`, or an absolute `http://` / `https://` URL only.
- `javascript:`, `data:`, protocol-relative `//...`, and other schemes must be rejected.
- Existing popup priority, delayed loading, close behavior, and KST “오늘 하루 보지 않기” behavior remain unchanged.
- Image popups do not show the existing “자세히 보기” button.
- No multi-popup UI, per-device image variants, crop editor, click analytics, or orphan-object cleanup in this scope.
- Server-only runtime variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.

## Review Focus

- A valid-looking but unsafe popup URL such as `javascript:alert(1)` must be rejected before persistence.
- A 5MB+1 byte image must fail before any Storage request is sent.
- A non-image MIME with an image extension must fail based on MIME, not file name.
- An existing notice row with both new columns NULL must still serialize and render as the current text popup.
- A Storage/API failure during upload must leave the current form data intact and must not create/update the notice automatically.

---

### Task 1: Extend notice schema, model, public DTO, and URL validation

**Files:**
- Create: `supabase/migrations/20261003120000_notice_image_popup.sql`
- Modify: `src/database/schema.ts`
- Modify: `src/database/repositories/notice-repository.ts`
- Modify: `src/lib/notices.ts`
- Modify: `src/app/api/admin/notices/route.ts`
- Modify: `src/app/api/admin/notices/[id]/route.ts`
- Create/Test: `tests/notice-image-popup.test.mjs`

**Interfaces:**
- Produces: `NoticeRow.popup_image_url: string | null`, `NoticeRow.popup_link_url: string | null`
- Produces: `NoticeInput.popupImageUrl: string | null`, `NoticeInput.popupLinkUrl: string | null`
- Produces: `PublicNotice.popupImageUrl: string | null`, `PublicNotice.popupLinkUrl: string | null`
- Produces: `normalizePopupLinkUrl(value: string | null | undefined): string | null` which throws on unsafe/non-supported URLs

- [ ] **Step 1: Write failing model/API regression tests**

In `tests/notice-image-popup.test.mjs`, assert that:
- the migration contains `popup_image_url` and `popup_link_url`;
- the SQLite incremental migration adds the same columns;
- repository INSERT and UPDATE include both fields;
- `PublicNotice` maps both fields;
- both Admin create/update routes accept and forward both fields;
- `normalizePopupLinkUrl("/reservation")` returns `"/reservation"`;
- `normalizePopupLinkUrl("https://example.com/x")` returns the URL;
- empty input returns `null`;
- `javascript:alert(1)`, `data:text/html,...`, and `//evil.example` throw.

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run: `node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs`  
Expected: FAIL because the new columns, DTO fields, and validator do not exist.

- [ ] **Step 3: Add the PostgreSQL and SQLite schema changes**

Create `supabase/migrations/20261003120000_notice_image_popup.sql` with idempotent column additions to `notices`. Add equivalent `tryExec("ALTER TABLE notices ADD COLUMN ...")` calls in `runIncrementalMigrations()`.

- [ ] **Step 4: Extend repository interfaces and SQL**

Update `NoticeRow`, `NoticeInput`, `insertNotice()`, and `updateNotice()` so both new nullable fields round-trip for SQLite and PostgreSQL.

- [ ] **Step 5: Add the shared popup-link normalizer**

Implement `normalizePopupLinkUrl(value)` in `src/lib/notices.ts`:
- trim whitespace;
- return `null` for empty;
- accept exactly one leading `/` but reject `//`;
- otherwise parse as URL and accept only `http:` or `https:`;
- throw an `Error` with an admin-readable Korean message on invalid input.

- [ ] **Step 6: Extend public DTO and Admin create/update routes**

Map the image/link fields in `toPublicNotice()`. Extend both Admin route schemas with nullable/optional strings, normalize the link before calling repository functions, and persist the image URL unchanged after trimming/empty-to-null normalization.

- [ ] **Step 7: Re-run the targeted test**

Run: `node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs`  
Expected: PASS for Task 1 assertions.

- [ ] **Step 8: Commit Task 1**

Commit message: `feat: extend notices for image popups`

---

### Task 2: Add Supabase Storage upload service and protected upload API

**Files:**
- Create: `src/lib/notice-image-storage.ts`
- Create: `src/app/api/admin/notices/upload-image/route.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Modify/Test: `tests/notice-image-popup.test.mjs`

**Interfaces:**
- Consumes: existing `requireAdminApiSession()`
- Produces: `validateNoticeImageMeta(meta: { type: string; size: number }): void`
- Produces: `uploadNoticeImage(file: File): Promise<{ url: string; path: string }>`
- HTTP: `POST /api/admin/notices/upload-image` with multipart field `file`, returns `{ ok: true, url: string }`

- [ ] **Step 1: Add failing storage/API tests**

Add assertions/tests that:
- allowed MIME types pass;
- `image/gif` and `text/plain` fail;
- exactly 5MB passes and 5MB+1 fails;
- the upload API calls `requireAdminApiSession()` before parsing/uploading;
- the server helper reads only server variables `SUPABASE_URL` and `SUPABASE_SECRET_KEY`;
- no `NEXT_PUBLIC_` secret is introduced;
- generated object paths start with `popup/` and do not reuse the original filename;
- upload requests use a fresh object path and do not set overwrite/upsert behavior.

- [ ] **Step 2: Run the targeted test and confirm failure**

Run: `node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs`  
Expected: FAIL because the storage helper and route do not exist.

- [ ] **Step 3: Implement pure upload validation and object naming**

In `src/lib/notice-image-storage.ts`, define:
- `NOTICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024`;
- MIME-to-extension mapping for PNG/JPEG/WebP;
- `validateNoticeImageMeta(...)`;
- unique object path generation using `crypto.randomUUID()`.

- [ ] **Step 4: Implement the server-side Supabase Storage request**

`uploadNoticeImage(file)` must:
- validate before network I/O;
- require `SUPABASE_URL` and `SUPABASE_SECRET_KEY`;
- upload bytes to `notice-images/popup/<uuid>.<ext>` using the Supabase Storage object endpoint;
- send the secret only in server-side headers;
- return the deterministic public object URL;
- throw a sanitized error if Storage rejects the upload.

- [ ] **Step 5: Implement the protected multipart route**

The route must:
- call `requireAdminApiSession()` first;
- read `request.formData()`;
- require one `File` in `file`;
- return 400 for missing/invalid MIME;
- return 413 for oversized files;
- return 502 for upstream Storage failure without exposing secret values;
- return 201 with `{ ok: true, url }` on success.

- [ ] **Step 6: Document runtime variables**

Add empty placeholders and server-only warnings for `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.example`. Add them to the README environment table with a note that the secret must never use `NEXT_PUBLIC_`.

- [ ] **Step 7: Re-run the targeted test**

Run: `node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs`  
Expected: PASS for Tasks 1–2 assertions.

- [ ] **Step 8: Commit Task 2**

Commit message: `feat: add protected notice image upload`

---

### Task 3: Add image upload, preview, removal, and optional link to Admin Notices

**Files:**
- Modify: `src/app/admin/(protected)/notices/page.tsx`
- Modify/Test: `tests/notice-image-popup.test.mjs`

**Interfaces:**
- Consumes: `POST /api/admin/notices/upload-image`
- Consumes/Persists: `popupImageUrl`, `popupLinkUrl`

- [ ] **Step 1: Add failing Admin UI source-contract tests**

Assert that the Admin page:
- includes `popup_image_url` and `popup_link_url` in the loaded Notice type;
- includes `popupImageUrl` and `popupLinkUrl` in form state;
- renders a file input accepting `.png,.jpg,.jpeg,.webp` or equivalent MIME accept list;
- posts the file to `/api/admin/notices/upload-image`;
- displays an image preview;
- has an “이미지 제거” action;
- renders an optional “이미지 클릭 링크” field;
- saves both new fields with the notice JSON;
- shows an `이미지 팝업` tag for rows with an image.

- [ ] **Step 2: Run the targeted test and confirm failure**

Run: `node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs`  
Expected: FAIL because Admin UI lacks the new controls.

- [ ] **Step 3: Extend Admin types and form state**

Add nullable image/link fields to `Notice` and string fields to `EMPTY`. Ensure `startNew()` clears them and `startEdit()` restores them.

- [ ] **Step 4: Add upload state and upload handler**

Add dedicated image-upload state separate from notice-save state. On file selection:
- perform client-side MIME/size checks;
- send `FormData` to the upload API;
- keep existing form content intact on failure;
- set `form.popupImageUrl` only after a successful response.

- [ ] **Step 5: Add preview, remove, and link controls**

Render:
- upload label and 5MB format hint;
- responsive image preview;
- “이미지 제거” button that clears only `popupImageUrl`;
- optional link input with “비워두면 클릭 이동 없음”.

- [ ] **Step 6: Persist fields and add list identification**

Include both fields in save JSON. Add `이미지 팝업` tag when `popup_image_url` is non-null.

- [ ] **Step 7: Re-run the targeted test**

Run: `node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs`  
Expected: PASS through Task 3.

- [ ] **Step 8: Commit Task 3**

Commit message: `feat: manage popup images in admin`

---

### Task 4: Render responsive image-first homepage popups

**Files:**
- Modify: `src/components/NoticePopup.tsx`
- Modify/Test: `tests/notice-image-popup.test.mjs`
- Verify existing: `tests/performance-first-load.test.mjs`

**Interfaces:**
- Consumes: public popup JSON fields `popupImageUrl`, `popupLinkUrl`
- Preserves: current `hideKey()`, `todayKST()`, idle/deferred fetch, session close, and “오늘 하루 보지 않기”

- [ ] **Step 1: Add failing popup rendering tests**

Assert that `NoticePopup.tsx`:
- declares nullable image/link fields in `PopupNotice`;
- conditionally branches on `notice.popupImageUrl`;
- uses `notice.title` as image alt text;
- caps the image popup around mobile viewport height and desktop max width;
- does not render “자세히 보기” inside the image branch;
- only wraps the image in a link when `popupLinkUrl` exists;
- still contains “닫기” and “오늘 하루 보지 않기”;
- still contains the existing idle-load logic.

- [ ] **Step 2: Run popup and performance tests and confirm the new test fails**

Run:
`node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs tests/performance-first-load.test.mjs`  
Expected: new image-popup assertions FAIL; existing performance assertions PASS.

- [ ] **Step 3: Extend the popup response type**

Add `popupImageUrl: string | null` and `popupLinkUrl: string | null` to the component type.

- [ ] **Step 4: Implement the image-mode branch**

When `popupImageUrl` exists:
- use a narrower image-first white dialog with mobile side padding and desktop max width around 500–550px;
- render the image with preserved ratio and max viewport height;
- if a link exists, make the image keyboard-focusable through an anchor and navigate in the current tab;
- omit title/content/detail button from the visual body unless needed as image-load fallback;
- keep close controls below the image.

Use a normal `<img>` for arbitrary Supabase public URLs and add a localized ESLint suppression for `@next/next/no-img-element` if required, rather than broadening global Next image host configuration.

- [ ] **Step 5: Preserve the current text branch verbatim where possible**

If there is no image URL, retain the current urgent badge, title, content, “자세히 보기”, close button, and “오늘 하루 보지 않기”.

- [ ] **Step 6: Re-run targeted and performance tests**

Run:
`node --experimental-loader ./tests/ts-loader.mjs --experimental-strip-types --test tests/notice-image-popup.test.mjs tests/performance-first-load.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit Task 4**

Commit message: `feat: render responsive image notice popups`

---

### Task 5: Apply Supabase production changes and perform full verification

**Files:**
- Verify: `supabase/migrations/20261003120000_notice_image_popup.sql`
- Verify: all files changed in Tasks 1–4

**Interfaces:**
- Production DB project: `dayrqharivegljceiydb`
- Storage bucket: `notice-images`
- Deployment gate: Vercel must contain server-only `SUPABASE_URL` and `SUPABASE_SECRET_KEY`

- [ ] **Step 1: Check current Supabase changelog/docs relevant to Storage before applying production changes**

Confirm no current breaking change affects public buckets, object upload endpoint authentication, or secret-key usage.

- [ ] **Step 2: Apply the notice columns to the production PostgreSQL database**

Use Supabase `execute_sql` with the same idempotent SQL as the migration. Query `information_schema.columns` afterward and assert both nullable text columns exist.

- [ ] **Step 3: Create/configure the `notice-images` bucket**

Create it as public with a 5MB limit and allowed MIME types PNG/JPEG/WebP. Query `storage.buckets` afterward and verify the settings.

- [ ] **Step 4: Run Supabase advisors**

Run database/security advisors and resolve any new issue introduced by this change before proceeding.

- [ ] **Step 5: Confirm runtime secrets before deployment**

Check Vercel environment variable names. If `SUPABASE_URL` or `SUPABASE_SECRET_KEY` is absent, stop deployment and request/add the missing server-only value; never substitute a publishable key for the secret.

- [ ] **Step 6: Run the full local/static verification suite**

Run:
- `npm run test:regression`
- `npm run lint`
- `npm run build`

Expected: all exit 0.

- [ ] **Step 7: Review the branch diff for scope and secret leakage**

Confirm:
- no secret values are committed;
- no `NEXT_PUBLIC_` secret variable exists;
- existing text popup behavior remains in the diff;
- no unrelated refactor was introduced.

- [ ] **Step 8: Deploy preview and verify Admin E2E**

In a preview deployment:
1. sign in to Admin;
2. open `/admin/notices`;
3. upload a valid mobile PNG/JPEG/WebP under 5MB;
4. confirm preview appears;
5. set `/reservation` as link;
6. save as published popup;
7. reopen edit and confirm image/link round-trip.

- [ ] **Step 9: Verify public popup on mobile and desktop**

Check at minimum:
- mobile width about 390px: no horizontal overflow, image fits within viewport, controls remain reachable;
- desktop: popup centered, max width bounded, image ratio preserved;
- image click follows configured link;
- link-less popup does not navigate;
- “닫기” works;
- “오늘 하루 보지 않기” suppresses the same notice for the KST day;
- a legacy text popup still renders in the old mode.

- [ ] **Step 10: Commit any verification-only fixes and request final code review**

Any code fix discovered during E2E gets its own focused commit. Then perform a whole-branch review against the spec before merge.

