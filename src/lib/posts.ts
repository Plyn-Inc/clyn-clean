import * as postRepo from "@/database/repositories/post-repository";
import { slugify } from "./utils";
import type { Post } from "./types";

export interface PostInput {
  title: string;
  content: string;
  coverImageUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  isPublished?: boolean;
  slug?: string;
}

export async function createPost(input: PostInput): Promise<Post> {
  const slug = input.slug ? slugify(input.slug) : slugify(input.title);
  const id = await postRepo.insert({
    slug,
    title: input.title,
    content: input.content,
    coverImageUrl: input.coverImageUrl ?? null,
    seoTitle: input.seoTitle ?? input.title,
    seoDescription: input.seoDescription ?? null,
    isPublished: input.isPublished === false ? 0 : 1,
  });
  const created = await postRepo.findById(id);
  if (!created) throw new Error("글 생성 결과를 찾을 수 없습니다.");
  return created;
}

export async function updatePost(id: number, input: Partial<PostInput>): Promise<void> {
  const current = await postRepo.findById(id);
  if (!current) throw new Error("글을 찾을 수 없습니다.");
  await postRepo.update(id, {
    title: input.title ?? current.title,
    content: input.content ?? current.content,
    coverImageUrl: input.coverImageUrl ?? current.cover_image_url,
    seoTitle: input.seoTitle ?? current.seo_title,
    seoDescription: input.seoDescription ?? current.seo_description,
    isPublished: input.isPublished === undefined ? current.is_published : input.isPublished ? 1 : 0,
  });
}

export function deletePost(id: number): Promise<void> { return postRepo.remove(id); }
export function getPostById(id: number): Promise<Post | undefined> { return postRepo.findById(id); }
export function getPostBySlug(slug: string): Promise<Post | undefined> { return postRepo.findBySlug(slug); }
export function listPosts(opts?: { onlyPublished?: boolean }): Promise<Post[]> { return postRepo.findAll(opts?.onlyPublished); }
