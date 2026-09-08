import { execute, insertReturningId, queryRow, queryRows } from "../connection";
import type { Post } from "@/lib/types";

export interface PostRowInput {
  slug: string;
  title: string;
  content: string;
  coverImageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  isPublished: number;
}

export function insert(row: PostRowInput): Promise<number> {
  return insertReturningId(
    `INSERT INTO posts (slug, title, content, cover_image_url, seo_title, seo_description, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.slug, row.title, row.content, row.coverImageUrl, row.seoTitle, row.seoDescription, row.isPublished]
  );
}

export function update(id: number, row: Omit<PostRowInput, "slug">): Promise<void> {
  return execute(
    `UPDATE posts SET
      title = ?, content = ?, cover_image_url = ?, seo_title = ?, seo_description = ?, is_published = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
    [row.title, row.content, row.coverImageUrl, row.seoTitle, row.seoDescription, row.isPublished, id]
  );
}

export function remove(id: number): Promise<void> {
  return execute("DELETE FROM posts WHERE id = ?", [id]);
}

export function findById(id: number): Promise<Post | undefined> {
  return queryRow<Post>("SELECT * FROM posts WHERE id = ?", [id]);
}

export function findBySlug(slug: string): Promise<Post | undefined> {
  return queryRow<Post>("SELECT * FROM posts WHERE slug = ?", [slug]);
}

export function findAll(onlyPublished?: boolean): Promise<Post[]> {
  if (onlyPublished) {
    return queryRows<Post>("SELECT * FROM posts WHERE is_published = 1 ORDER BY created_at DESC");
  }
  return queryRows<Post>("SELECT * FROM posts ORDER BY created_at DESC");
}
