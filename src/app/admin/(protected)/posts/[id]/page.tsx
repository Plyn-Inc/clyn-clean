import { notFound } from "next/navigation";
import { getPostById } from "@/lib/posts";
import PostForm from "@/components/admin/PostForm";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPostById(Number(id));
  if (!post) notFound();

  return (
    <div>
      <h1 className="font-display text-xl font-bold">블로그 글 수정</h1>
      <div className="mt-6">
        <PostForm initial={post} postId={post.id} />
      </div>
    </div>
  );
}
