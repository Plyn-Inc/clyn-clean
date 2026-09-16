import { execute, insertReturningId, queryRow, queryRows } from "../connection";

export type NoticeType = "normal" | "urgent";

export interface NoticeRow {
  id: number;
  title: string;
  content: string;
  notice_type: NoticeType;
  is_published: number;
  is_pinned: number;
  is_popup: number;
  publish_start_at: string | null;
  publish_end_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * 공개 조건.
 *
 * is_published = 1
 * AND (publish_start_at IS NULL OR publish_start_at <= now)
 * AND (publish_end_at   IS NULL OR publish_end_at   >= now)
 */
const PUBLIC_WHERE = `
  is_published = 1
  AND (publish_start_at IS NULL OR publish_start_at <= ?)
  AND (publish_end_at IS NULL OR publish_end_at >= ?)`;

/**
 * 공개 공지 목록.
 *
 * 정렬: 긴급+고정 → 고정 → 긴급 → 최신
 * 동순위는 id DESC로 결정적으로 정렬한다.
 */
export function listPublicNotices(now: string): Promise<NoticeRow[]> {
  return queryRows<NoticeRow>(
    `SELECT * FROM notices
      WHERE ${PUBLIC_WHERE}
      ORDER BY is_pinned DESC,
               CASE WHEN notice_type = 'urgent' THEN 1 ELSE 0 END DESC,
               created_at DESC,
               id DESC`,
    [now, now]
  );
}

/** 공개 공지 단건. 비공개/기간 밖이면 undefined (public에서 노출 금지) */
export function findPublicNotice(id: number, now: string): Promise<NoticeRow | undefined> {
  return queryRow<NoticeRow>(
    `SELECT * FROM notices WHERE id = ? AND ${PUBLIC_WHERE}`,
    [id, now, now]
  );
}

/**
 * 팝업 후보 1건.
 *
 * 여러 팝업을 동시에 띄워 고객을 방해하지 않는다.
 * 우선순위: urgent → pinned → 최신
 * 긴급공지라도 is_popup이 꺼져 있으면 팝업이 되지 않는다.
 */
export function findPopupNotice(now: string): Promise<NoticeRow | undefined> {
  return queryRow<NoticeRow>(
    `SELECT * FROM notices
      WHERE is_popup = 1 AND ${PUBLIC_WHERE}
      ORDER BY CASE WHEN notice_type = 'urgent' THEN 1 ELSE 0 END DESC,
               is_pinned DESC,
               created_at DESC,
               id DESC
      LIMIT 1`,
    [now, now]
  );
}

// --- Admin (공개 여부와 무관하게 전체 조회) ---

export function listAllNotices(): Promise<NoticeRow[]> {
  return queryRows<NoticeRow>(
    `SELECT * FROM notices ORDER BY is_pinned DESC, created_at DESC, id DESC`
  );
}

export function findNoticeById(id: number): Promise<NoticeRow | undefined> {
  return queryRow<NoticeRow>("SELECT * FROM notices WHERE id = ?", [id]);
}

export interface NoticeInput {
  title: string;
  content: string;
  noticeType: NoticeType;
  isPublished: boolean;
  isPinned: boolean;
  isPopup: boolean;
  publishStartAt: string | null;
  publishEndAt: string | null;
  createdBy?: number | null;
}

export function insertNotice(input: NoticeInput): Promise<number> {
  return insertReturningId(
    `INSERT INTO notices
       (title, content, notice_type, is_published, is_pinned, is_popup,
        publish_start_at, publish_end_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title, input.content, input.noticeType,
      input.isPublished ? 1 : 0, input.isPinned ? 1 : 0, input.isPopup ? 1 : 0,
      input.publishStartAt, input.publishEndAt, input.createdBy ?? null,
    ]
  );
}

export function updateNotice(id: number, input: NoticeInput): Promise<void> {
  return execute(
    `UPDATE notices SET
       title = ?, content = ?, notice_type = ?,
       is_published = ?, is_pinned = ?, is_popup = ?,
       publish_start_at = ?, publish_end_at = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [
      input.title, input.content, input.noticeType,
      input.isPublished ? 1 : 0, input.isPinned ? 1 : 0, input.isPopup ? 1 : 0,
      input.publishStartAt, input.publishEndAt, id,
    ]
  );
}

export function deleteNotice(id: number): Promise<void> {
  return execute("DELETE FROM notices WHERE id = ?", [id]);
}
