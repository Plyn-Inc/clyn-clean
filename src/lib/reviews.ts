import * as reviewRepo from "@/database/repositories/review-repository";
import { slugify } from "./utils";
import type { Review } from "./types";

export interface ReviewInput {
  serviceType: string;
  region: string;
  areaPyeong?: number;
  content: string;
  beforePhotoUrl?: string;
  afterPhotoUrl?: string;
  isPublished?: boolean;
}

export async function createReview(input: ReviewInput): Promise<Review> {
  const slug = slugify(`${input.serviceType}-${input.region}`);
  const id = await reviewRepo.insert({
    slug,
    serviceType: input.serviceType,
    region: input.region,
    areaPyeong: input.areaPyeong ?? null,
    content: input.content,
    beforePhotoUrl: input.beforePhotoUrl ?? null,
    afterPhotoUrl: input.afterPhotoUrl ?? null,
    isPublished: input.isPublished === false ? 0 : 1,
  });
  const created = await reviewRepo.findById(id);
  if (!created) throw new Error("후기 생성 결과를 찾을 수 없습니다.");
  return created;
}

export async function updateReview(id: number, input: Partial<ReviewInput>): Promise<void> {
  const current = await reviewRepo.findById(id);
  if (!current) throw new Error("후기를 찾을 수 없습니다.");
  await reviewRepo.update(id, {
    serviceType: input.serviceType ?? current.service_type,
    region: input.region ?? current.region,
    areaPyeong: input.areaPyeong ?? current.area_pyeong,
    content: input.content ?? current.content,
    beforePhotoUrl: input.beforePhotoUrl ?? current.before_photo_url,
    afterPhotoUrl: input.afterPhotoUrl ?? current.after_photo_url,
    isPublished: input.isPublished === undefined ? current.is_published : input.isPublished ? 1 : 0,
  });
}

export function deleteReview(id: number): Promise<void> { return reviewRepo.remove(id); }
export function getReviewById(id: number): Promise<Review | undefined> { return reviewRepo.findById(id); }
export function getReviewBySlug(slug: string): Promise<Review | undefined> { return reviewRepo.findBySlug(slug); }
export function listReviews(opts?: { onlyPublished?: boolean }): Promise<Review[]> { return reviewRepo.findAll(opts?.onlyPublished); }
