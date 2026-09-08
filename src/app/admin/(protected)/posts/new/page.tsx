import PostForm from "@/components/admin/PostForm";

export default function NewPostPage() {
  return (
    <div>
      <h1 className="font-display text-xl font-bold">블로그 글 작성</h1>
      <div className="mt-6">
        <PostForm />
      </div>
    </div>
  );
}
