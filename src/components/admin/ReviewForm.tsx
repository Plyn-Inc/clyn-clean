"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_TYPES } from "@/lib/types";
import type { Review } from "@/lib/types";

export default function ReviewForm({ initial, reviewId }: { initial?: Review; reviewId?: number }) {
  const router = useRouter();
  const [serviceType, setServiceType] = useState(initial?.service_type || SERVICE_TYPES[0]);
  const [region, setRegion] = useState(initial?.region || "");
  const [areaPyeong, setAreaPyeong] = useState(initial?.area_pyeong?.toString() || "");
  const [content, setContent] = useState(initial?.content || "");
  const [beforePhotoUrl, setBeforePhotoUrl] = useState(initial?.before_photo_url || "");
  const [afterPhotoUrl, setAfterPhotoUrl] = useState(initial?.after_photo_url || "");
  const [isPublished, setIsPublished] = useState(initial ? initial.is_published === 1 : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!region.trim() || !content.trim()) {
      setError("지역과 후기 내용은 필수입니다.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      serviceType,
      region,
      areaPyeong: areaPyeong ? Number(areaPyeong) : undefined,
      content,
      beforePhotoUrl: beforePhotoUrl || undefined,
      afterPhotoUrl: afterPhotoUrl || undefined,
      isPublished,
    };

    try {
      const res = reviewId
        ? await fetch(`/api/admin/reviews/${reviewId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/reviews", {
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
      router.push("/admin/reviews");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-semibold">청소 종류</label>
        <select
          value={serviceType}
          onChange={(e) => setServiceType(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm"
        >
          {SERVICE_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-semibold">지역</label>
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold">평수</label>
          <input
            type="number"
            value={areaPyeong}
            onChange={(e) => setAreaPyeong(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold">작업 전 사진 URL</label>
        <input
          value={beforePhotoUrl}
          onChange={(e) => setBeforePhotoUrl(e.target.value)}
          placeholder="https://..."
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-semibold">작업 후 사진 URL</label>
        <input
          value={afterPhotoUrl}
          onChange={(e) => setAfterPhotoUrl(e.target.value)}
          placeholder="https://..."
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold">후기 내용</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm"
        />
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
        {saving ? "저장 중..." : reviewId ? "수정 저장" : "후기 등록"}
      </button>
    </div>
  );
}
