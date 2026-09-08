import ReviewForm from "@/components/admin/ReviewForm";

export default function NewReviewPage() {
  return (
    <div>
      <h1 className="font-display text-xl font-bold">후기 작성</h1>
      <div className="mt-6">
        <ReviewForm />
      </div>
    </div>
  );
}
