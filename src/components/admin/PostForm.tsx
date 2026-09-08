"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/types";

export default function PostForm({ initial, postId }: { initial?: Post; postId?: number }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title || "");
  const [content, setContent] = useState(initial?.content || "");
  const [coverImageUrl, setCoverImageUrl] = useState(initial?.cover_image_url || "");
  const [seoTitle, setSeoTitle] = useState(initial?.seo_title || "");
  const [seoDescription, setSeoDescription] = useState(initial?.seo_description || "");
  const [isPublished, setIsPublished] = useState(initial ? initial.is_published === 1 : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim() || !content.trim()) {
      setError("제목과 본문은 필수입니다.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      title,
      content,
      coverImageUrl: coverImageUrl || undefined,
      seoTitle: seoTitle || undefined,
      seoDescription: seoDescription || undefined,
      isPublished,
    };

    try {
      const res = postId
        ? await fetch(`/api/admin/posts/${postId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "저장 중 오류가 발생했습니다.");
        setSaving(false);
        return;
      }
      router.push("/admin/posts");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-semibold">제목</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold">대표 이미지 URL</label>
        <input
          value={coverImageUrl}
          onChange={(e) => setCoverImageUrl(e.target.value)}
          placeholder="https://..."
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold">본문</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
        />
      </div>

      <div className="rounded-xl border border-[var(--line)] p-4">
        <p className="mb-3 text-sm font-semibold">SEO 설정</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">SEO 제목</label>
            <input
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              placeholder="비워두면 글 제목이 사용됩니다"
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">SEO 설명</label>
            <textarea
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
            />
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPublished}
          onChange={(e) => setIsPublished(e.target.checked)}
          className="h-4 w-4"
        />
        공개 상태로 노출
      </label>

      {error && <div className="rounded-lg bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">{error}</div>}

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="rounded-full bg-[var(--navy)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-60"
      >
        {saving ? "저장 중..." : postId ? "수정 저장" : "글 등록"}
      </button>
    </div>
  );
}
