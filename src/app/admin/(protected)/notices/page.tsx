"use client";

import { useEffect, useState } from "react";

interface Notice {
  id: number;
  title: string;
  content: string;
  notice_type: "normal" | "urgent";
  is_published: number;
  is_pinned: number;
  is_popup: number;
  publish_start_at: string | null;
  publish_end_at: string | null;
  created_at: string;
}

const EMPTY = {
  title: "", content: "", noticeType: "normal" as "normal" | "urgent",
  isPublished: false, isPinned: false, isPopup: false,
  publishStartAt: "", publishEndAt: "",
};

/** ISO(UTC) → datetime-local 입력값 (Asia/Seoul) */
function isoToKstInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export default function AdminNoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY & { noticeType: "normal" | "urgent" }>({ ...EMPTY });
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const d = await fetch("/api/admin/notices").then((r) => r.json());
      setNotices(d.notices ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => { void load(); });
  }, []);

  function startNew() {
    setEditingId(null);
    setForm({ ...EMPTY });
  }

  function startEdit(n: Notice) {
    setEditingId(n.id);
    setForm({
      title: n.title,
      content: n.content,
      noticeType: n.notice_type,
      isPublished: n.is_published === 1,
      isPinned: n.is_pinned === 1,
      isPopup: n.is_popup === 1,
      publishStartAt: isoToKstInput(n.publish_start_at),
      publishEndAt: isoToKstInput(n.publish_end_at),
    });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const url = editingId ? `/api/admin/notices/${editingId}` : "/api/admin/notices";
    const res = await fetch(url, {
      method: editingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        publishStartAt: form.publishStartAt || null,
        publishEndAt: form.publishEndAt || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setMsg({ type: "ok", text: editingId ? "수정했습니다." : "등록했습니다." });
      startNew();
      void load();
    } else {
      setMsg({ type: "err", text: data.error ?? "저장에 실패했습니다." });
    }
  }

  async function remove(id: number) {
    if (!confirm("이 공지를 삭제할까요? 되돌릴 수 없습니다.")) return;
    const res = await fetch(`/api/admin/notices/${id}`, { method: "DELETE" });
    if (res.ok) { setMsg({ type: "ok", text: "삭제했습니다." }); void load(); }
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft)]">불러오는 중...</p>;

  return (
    <div className="max-w-3xl space-y-7">
      <div>
        <h1 className="font-display text-xl font-bold">공지 / 팝업 관리</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
          공개된 공지만 고객에게 노출됩니다. 팝업을 켜면 홈페이지 진입 시 한 번 표시되며,
          여러 개를 켜도 우선순위(긴급 → 고정 → 최신)에 따라 한 번에 1개만 노출됩니다.
          노출 기간은 한국 시간 기준입니다.
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm ${msg.type === "ok" ? "bg-[var(--mint-soft)] text-[var(--mint)]" : "bg-[#FBEAE5] text-[var(--rose)]"}`}>
          {msg.text}
        </div>
      )}

      <section className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <p className="text-sm font-semibold">{editingId ? "공지 수정" : "새 공지 작성"}</p>

        <div className="mt-4 space-y-3">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="제목"
            className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
          />
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="내용 (줄바꿈이 그대로 표시됩니다)"
            rows={7}
            className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm"
          />

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={form.noticeType === "urgent"}
                onChange={(e) => setForm({ ...form, noticeType: e.target.checked ? "urgent" : "normal" })}
              />
              긴급공지
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.isPublished}
                onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />
              공개
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.isPinned}
                onChange={(e) => setForm({ ...form, isPinned: e.target.checked })} />
              상단 고정
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={form.isPopup}
                onChange={(e) => setForm({ ...form, isPopup: e.target.checked })} />
              팝업
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--ink-soft)]">
              노출 시작 (KST)
              <input type="datetime-local" value={form.publishStartAt}
                onChange={(e) => setForm({ ...form, publishStartAt: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
            </label>
            <label className="text-xs text-[var(--ink-soft)]">
              노출 종료 (KST)
              <input type="datetime-local" value={form.publishEndAt}
                onChange={(e) => setForm({ ...form, publishEndAt: e.target.value })}
                className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
            </label>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button disabled={saving || !form.title.trim() || !form.content.trim()} onClick={save}
            className="rounded-lg bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "저장 중..." : editingId ? "수정" : "등록"}
          </button>
          {editingId && (
            <button onClick={startNew}
              className="rounded-lg border border-[var(--line)] px-5 py-2.5 text-sm font-semibold text-[var(--ink-soft)]">
              취소
            </button>
          )}
        </div>
      </section>

      <section>
        <p className="mb-3 text-sm font-semibold">공지 목록 ({notices.length})</p>
        {notices.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">등록된 공지가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {notices.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] bg-white p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {n.notice_type === "urgent" && <Tag text="긴급" tone="rose" />}
                    {n.is_pinned === 1 && <Tag text="고정" />}
                    {n.is_popup === 1 && <Tag text="팝업" tone="mint" />}
                    <Tag text={n.is_published === 1 ? "공개" : "비공개"} tone={n.is_published === 1 ? "mint" : undefined} />
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium">{n.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                    {n.created_at.slice(0, 10)}
                    {n.publish_start_at && ` · 시작 ${isoToKstInput(n.publish_start_at).replace("T", " ")}`}
                    {n.publish_end_at && ` · 종료 ${isoToKstInput(n.publish_end_at).replace("T", " ")}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => startEdit(n)}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium">수정</button>
                  <button onClick={() => remove(n.id)}
                    className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--rose)]">삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Tag({ text, tone }: { text: string; tone?: "rose" | "mint" }) {
  const cls =
    tone === "rose" ? "bg-[#FBEAE5] text-[var(--rose)]"
    : tone === "mint" ? "bg-[var(--mint-soft)] text-[var(--mint)]"
    : "bg-[var(--sand-deep)] text-[var(--ink-soft)]";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>;
}
