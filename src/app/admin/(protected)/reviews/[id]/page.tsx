import { notFound } from "next/navigation";
import { getReviewById } from "@/lib/reviews";
import ReviewForm from "@/components/admin/ReviewForm";

export default async function EditReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const review = await getReviewById(Number(id));
  if (!review) notFound();

  return (
    <div>
      <h1 className="font-display text-xl font-bold">후기 수정</h1>
      <div className="mt-6">
        <ReviewForm initial={review} reviewId={review.id} />
      </div>
    </div>
  );
}
