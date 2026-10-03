/**
 * 공지사항 / 팝업.
 *
 * content는 평문 multiline 텍스트다. HTML을 저장하거나 렌더링하지 않는다(XSS 방지).
 * 줄바꿈은 화면에서 CSS(whitespace-pre-line)로 안전하게 표시한다.
 */
import * as repo from "@/database/repositories/notice-repository";

export type { NoticeRow, NoticeType, NoticeInput } from "@/database/repositories/notice-repository";

/** 공개 응답 — Admin 전용 필드(created_by 등)를 노출하지 않는다 */
export interface PublicNotice {
  id: number;
  title: string;
  content: string;
  noticeType: repo.NoticeType;
  isPinned: boolean;
  popupImageUrl: string | null;
  popupLinkUrl: string | null;
  publishedAt: string;
}

export function toPublicNotice(row: repo.NoticeRow): PublicNotice {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    noticeType: row.notice_type,
    isPinned: row.is_pinned === 1,
    popupImageUrl: row.popup_image_url,
    popupLinkUrl: row.popup_link_url,
    publishedAt: row.publish_start_at ?? row.created_at,
  };
}

export function normalizePopupLinkUrl(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;

  if (v.startsWith("/")) {
    if (v.startsWith("//")) {
      throw new Error("이미지 클릭 링크 주소를 확인해주세요.");
    }
    return v;
  }

  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw new Error("이미지 클릭 링크 URL 형식을 확인해주세요.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("이미지 클릭 링크는 내부 경로 또는 http/https URL만 사용할 수 있습니다.");
  }
  return v;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listPublishedNotices(): Promise<PublicNotice[]> {
  return (await repo.listPublicNotices(nowIso())).map(toPublicNotice);
}

export async function getPublishedNotice(id: number): Promise<PublicNotice | null> {
  const row = await repo.findPublicNotice(id, nowIso());
  return row ? toPublicNotice(row) : null;
}

/** 홈페이지 팝업 후보 1건 (없으면 null) */
export async function getPopupNotice(): Promise<PublicNotice | null> {
  const row = await repo.findPopupNotice(nowIso());
  return row ? toPublicNotice(row) : null;
}

/**
 * Admin 입력(Asia/Seoul)을 timestamptz로 변환한다.
 *
 * `2026-09-20T10:00` 같은 datetime-local 값은 타임존이 없으므로
 * KST(+09:00)로 해석한 뒤 ISO(UTC)로 저장한다.
 */
export function kstInputToIso(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  // 이미 타임존이 붙어 있으면 그대로 해석한다
  if (/[Zz]$|[+-]\d{2}:\d{2}$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const listAllNotices = repo.listAllNotices;
export const findNoticeById = repo.findNoticeById;
export const insertNotice = repo.insertNotice;
export const updateNotice = repo.updateNotice;
export const deleteNotice = repo.deleteNotice;
