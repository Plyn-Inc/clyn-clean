"use client";

import { useState } from "react";
import { SERVICE_TYPES, HOUSE_TYPES_FIXED, HOUSE_SIZES_APARTMENT } from "@/lib/types";
import WorkAreaInput, { type WorkAreaValue } from "@/components/booking/WorkAreaInput";
import { bookingMinDate, bookingMaxDate } from "@/lib/booking-window";

const HOUSE_KEYS: string[] = [
  ...HOUSE_TYPES_FIXED,
  ...HOUSE_SIZES_APARTMENT.map((n) => `${n}평`),
];

export default function ConsultationForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [area, setArea] = useState<WorkAreaValue>({ sido: "", sigungu: "", dong: "" });
  const [address, setAddress] = useState("");
  const [serviceType, setServiceType] = useState<string>(SERVICE_TYPES[0]);
  const [houseTypeKey, setHouseTypeKey] = useState("");
  const [actualPyeong, setActualPyeong] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [hasPet, setHasPet] = useState(false);
  const [petNote, setPetNote] = useState("");
  const [notes, setNotes] = useState("");
  const [jipjeongriInfo, setJipjeongriInfo] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCode, setDoneCode] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setError("이름을 입력해주세요.");
    if (!phone.trim()) return setError("연락처를 입력해주세요.");
    if (!area.sido || !area.sigungu || !area.dong) return setError("작업지역을 모두 선택해주세요.");
    if (!serviceType) return setError("청소 종류를 선택해주세요.");
    if (serviceType === "집정리") {
      if (!jipjeongriInfo.trim()) return setError("정리가 필요한 공간이나 물품을 입력해주세요.");
    } else if (!houseTypeKey && !actualPyeong) {
      return setError("주택유형 또는 공급면적을 입력해주세요.");
    }
    if (!preferredDate) return setError("희망 날짜를 선택해주세요.");
    if (!notes.trim()) return setError("상담 내용을 입력해주세요.");
    if (!agreed) return setError("개인정보 수집·이용에 동의해주세요.");
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          areaSido: area.sido || undefined,
          areaSigungu: area.sigungu || undefined,
          areaDong: area.dong || undefined,
          address: address || undefined,
          serviceType,
          houseTypeKey: houseTypeKey || undefined,
          actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
          preferredDate: preferredDate || undefined,
          reason: hasPet ? "pet" : houseTypeKey === "40평" ? "size_40_plus" : "manual",
          petMeta: hasPet ? { hasPet: true, note: petNote } : null,
          extraNotes: notes || undefined,
          jipjeongriInfo: serviceType === "집정리" ? jipjeongriInfo : undefined,
          privacyAgreed: agreed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "상담 접수 중 오류가 발생했습니다.");
        return;
      }
      setDoneCode(data.requestCode);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  if (doneCode) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-white p-7 text-center md:p-9">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--mint-soft)] text-2xl text-[var(--mint)]">
          ✓
        </div>
        <h2 className="font-display text-xl font-bold">상담 접수가 완료되었습니다</h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          접수번호 <strong className="text-[var(--ink)]">{doneCode}</strong>
        </p>
        <p className="mt-4 text-sm leading-relaxed text-[var(--ink-soft)]">
          담당자가 확인 후 영업일 기준 24시간 이내 연락드리겠습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-6 md:p-8">
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="이름" required value={name} onChange={setName} />
        <Field label="연락처" required value={phone} onChange={setPhone} placeholder="010-0000-0000" />

        <div className="md:col-span-2">
          <WorkAreaInput value={area} onChange={setArea} />
        </div>

        <div className="md:col-span-2">
          <Field label="상세 주소 (선택)" value={address} onChange={setAddress} />
        </div>

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold">청소 종류</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SERVICE_TYPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setServiceType(s)}
                className={`min-h-[44px] rounded-xl border text-sm font-medium transition ${
                  serviceType === s
                    ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                    : "border-[var(--line)] text-[var(--ink-soft)]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {serviceType === "집정리" ? (
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold">
              정리가 필요한 공간·물품 <span className="text-xs text-[var(--rose)]">*필수</span>
            </label>
            <textarea
              value={jipjeongriInfo}
              onChange={(e) => setJipjeongriInfo(e.target.value)}
              rows={3}
              placeholder="예: 드레스룸 옷 정리, 주방 상부장, 팬트리 식료품 분류"
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
              집정리는 평형이 아니라 인원·시간 기준이라 정리 범위를 알려주시면 정확히 안내드릴 수 있습니다.
            </p>
          </div>
        ) : (
        <div>
          <label className="mb-1.5 block text-sm font-semibold">
            주택유형 <span className="text-xs text-[var(--rose)]">*주택유형 또는 공급면적 필수</span>
          </label>
          <select
            value={houseTypeKey}
            onChange={(e) => setHouseTypeKey(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
          >
            <option value="">선택 안 함</option>
            {HOUSE_KEYS.map((k) => (
              <option key={k} value={k}>{k === "40평" ? "40평 이상" : k}</option>
            ))}
          </select>
        </div>

        )}

        {serviceType !== "집정리" && (
          <Field
            label="공급면적 (평)"
            value={actualPyeong}
            onChange={setActualPyeong}
            type="number"
            placeholder="예: 52"
          />
        )}

        <div>
          <label className="mb-1.5 block text-sm font-semibold">
            희망 날짜 <span className="text-xs text-[var(--rose)]">*필수</span>
          </label>
          <input
            type="date"
            value={preferredDate}
            min={bookingMinDate()}
            max={bookingMaxDate()}
            onChange={(e) => setPreferredDate(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold">반려동물</label>
          <div className="flex gap-2">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setHasPet(v)}
                className={`min-h-[44px] flex-1 rounded-lg border text-sm font-medium ${
                  hasPet === v
                    ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                    : "border-[var(--line)] text-[var(--ink-soft)]"
                }`}
              >
                {v ? "있음" : "없음"}
              </button>
            ))}
          </div>
        </div>

        {hasPet && (
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold">반려동물 정보</label>
            <textarea
              value={petNote}
              onChange={(e) => setPetNote(e.target.value)}
              rows={2}
              placeholder="종류, 마리 수, 털·냄새·배변 오염 정도 등"
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
            />
          </div>
        )}

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold">
            상담 내용 <span className="text-xs text-[var(--rose)]">*필수</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="현장 상황이나 문의하실 내용을 자유롭게 적어주세요."
            className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
          />
        </div>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-xl bg-[var(--sand-deep)] p-4">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded"
        />
        <span className="text-sm">
          <strong className="text-[var(--rose)]">[필수]</strong> 상담을 위한 개인정보 수집·이용에 동의합니다.{" "}
          <a href="/privacy" target="_blank" className="text-[var(--mint)] underline">개인정보처리방침</a>
        </span>
      </label>

      {error && (
        <div className="mt-4 rounded-lg bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">{error}</div>
      )}

      <button
        onClick={submit}
        disabled={submitting || !agreed}
        className="mt-6 min-h-[52px] w-full rounded-full bg-[var(--navy)] text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-50"
      >
        {submitting ? "접수 중..." : "상담 접수하기"}
      </button>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = "text", required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold">
        {label} {required && <span className="text-xs text-[var(--rose)]">*필수</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
      />
    </div>
  );
}
