"use client";

import { useEffect, useState } from "react";
import {
  CONSULTATION_STATUS_LABEL,
  CONSULTATION_REASON_LABEL,
  type ConsultationRequest,
  type ConsultationStatus,
} from "@/lib/types";

const STATUSES: ConsultationStatus[] = ["received", "contacting", "converted", "closed"];

export default function AdminConsultationsPage() {
  const [items, setItems] = useState<ConsultationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ConsultationStatus | "">("");
  const [selected, setSelected] = useState<ConsultationRequest | null>(null);
  const [memo, setMemo] = useState("");

  function load(status: ConsultationStatus | "") {
    setLoading(true);
    const url = status ? `/api/admin/consultations?status=${status}` : "/api/admin/consultations";
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setItems(d.consultations ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/consultations")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setItems(d.consultations ?? []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function updateStatus(id: number, status: ConsultationStatus) {
    await fetch(`/api/admin/consultations/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load(filter);
    setSelected(null);
  }

  async function saveMemo(id: number) {
    await fetch(`/api/admin/consultations/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memo }),
    });
    load(filter);
    setSelected(null);
  }

  return (
    <div>
      <h1 className="font-display text-xl font-bold">상담 접수 관리</h1>
      <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
        40평 이상, 반려동물 동거 등 자동예약이 불가한 건입니다. 상담접수는 예약 캘린더 수량을 차감하지 않습니다.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={() => { setFilter(""); load(""); }}
          className={`rounded-full border px-4 py-2 text-xs font-medium ${filter === "" ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
          전체
        </button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => { setFilter(s); load(s); }}
            className={`rounded-full border px-4 py-2 text-xs font-medium ${filter === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
            {CONSULTATION_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--ink-soft)]">접수된 상담이 없습니다.</p>
      ) : (
        <div className="mt-5 space-y-2">
          {items.map((c) => (
            <button key={c.id} onClick={() => { setSelected(c); setMemo(c.admin_memo ?? ""); }}
              className="w-full rounded-xl border border-[var(--line)] bg-white p-4 text-left transition hover:border-[var(--mint)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-sm font-bold">{c.request_code}</span>
                <span className="rounded-full bg-[var(--sand-deep)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ink-soft)]">
                  {CONSULTATION_STATUS_LABEL[c.status]}
                </span>
                <span className="rounded-full bg-[#FBE9D3] px-2.5 py-0.5 text-[11px] font-medium text-[var(--amber)]">
                  {CONSULTATION_REASON_LABEL[c.reason as keyof typeof CONSULTATION_REASON_LABEL] ?? c.reason}
                </span>
              </div>
              <p className="mt-1.5 text-sm">
                {c.customer_name} · {c.customer_phone}
                {c.service_type ? ` · ${c.service_type}` : ""}
                {c.house_type_key ? ` · ${c.house_type_key === "40평" ? "40평 이상" : c.house_type_key}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                희망일 {c.preferred_date ?? "-"} · 접수 {new Date(c.created_at).toLocaleString("ko-KR")}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6"
          onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-lg font-bold">{selected.request_code}</p>
            <dl className="mt-4 space-y-1.5 text-sm">
              <Row label="이름" value={selected.customer_name} />
              <Row label="연락처" value={selected.customer_phone} />
              <Row label="작업지역" value={[selected.area_sido, selected.area_sigungu, selected.area_dong].filter(Boolean).join(" ") || "-"} />
              <Row label="상세주소" value={selected.address ?? "-"} />
              <Row label="서비스" value={selected.service_type ?? "-"} />
              <Row label="주택유형" value={selected.house_type_key === "40평" ? "40평 이상" : selected.house_type_key ?? "-"} />
              <Row label="공급면적" value={selected.actual_pyeong ? `${selected.actual_pyeong}평` : "-"} />
              <Row label="희망일" value={selected.preferred_date ?? "-"} />
              <Row label="전환 사유" value={CONSULTATION_REASON_LABEL[selected.reason as keyof typeof CONSULTATION_REASON_LABEL] ?? selected.reason} />
              {selected.reference_price != null && (
                <Row label="참고 시작가" value={`${selected.reference_price.toLocaleString("ko-KR")}원 (확정 견적 아님)`} />
              )}
            </dl>

            {selected.pet_meta && (
              <div className="mt-4 rounded-xl bg-[var(--sand-deep)] p-4">
                <p className="mb-1.5 text-xs font-bold text-[var(--ink)]">반려동물 정보</p>
                <pre className="whitespace-pre-wrap break-all text-xs text-[var(--ink-soft)]">
                  {JSON.stringify(JSON.parse(selected.pet_meta), null, 2)}
                </pre>
              </div>
            )}

            {selected.extra_notes && (
              <div className="mt-3 rounded-xl bg-[var(--sand-deep)] p-4">
                <p className="mb-1.5 text-xs font-bold text-[var(--ink)]">상담 내용</p>
                <p className="whitespace-pre-wrap text-xs text-[var(--ink-soft)]">{selected.extra_notes}</p>
              </div>
            )}

            <div className="mt-4">
              <p className="mb-1.5 text-xs font-bold">관리자 메모</p>
              <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3}
                className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
              <button onClick={() => saveMemo(selected.id)}
                className="mt-2 rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-semibold">
                메모 저장
              </button>
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-xs font-bold">상태 변경</p>
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button key={s} onClick={() => updateStatus(selected.id, s)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                      selected.status === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)]"}`}>
                    {CONSULTATION_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => setSelected(null)}
              className="mt-5 w-full rounded-full border border-[var(--line)] py-3 text-sm font-semibold">
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--ink-soft)]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
