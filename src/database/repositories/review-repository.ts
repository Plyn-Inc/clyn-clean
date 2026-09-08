import { execute, insertReturningId, queryRow, queryRows } from "../connection";
import type { Review } from "@/lib/types";

export interface ReviewRowInput {
  slug: string;
  serviceType: string;
  region: string;
  areaPyeong: number | null;
  content: string;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  isPublished: number;
}

export function insert(row: ReviewRowInput): Promise<number> {
  return insertReturningId(
    `INSERT INTO reviews (slug, service_type, region, area_pyeong, content, before_photo_url, after_photo_url, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.slug, row.serviceType, row.region, row.areaPyeong, row.content, row.beforePhotoUrl, row.afterPhotoUrl, row.isPublished]
  );
}

export function update(id: number, row: Omit<ReviewRowInput, "slug">): Promise<void> {
  return execute(
    `UPDATE reviews SET
      service_type = ?, region = ?, area_pyeong = ?, content = ?, before_photo_url = ?, after_photo_url = ?, is_published = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    [row.serviceType, row.region, row.areaPyeong, row.content, row.beforePhotoUrl, row.afterPhotoUrl, row.isPublished, id]
  );
}

export function remove(id: number): Promise<void> {
  return execute("DELETE FROM reviews WHERE id = ?", [id]);
}

export function findById(id: number): Promise<Review | undefined> {
  return queryRow<Review>("SELECT * FROM reviews WHERE id = ?", [id]);
}

export function findBySlug(slug: string): Promise<Review | undefined> {
  return queryRow<Review>("SELECT * FROM reviews WHERE slug = ?", [slug]);
}

export function findAll(onlyPublished?: boolean): Promise<Review[]> {
  if (onlyPublished) {
    return queryRows<Review>("SELECT * FROM reviews WHERE is_published = 1 ORDER BY created_at DESC");
  }
  return queryRows<Review>("SELECT * FROM reviews ORDER BY created_at DESC");
}
