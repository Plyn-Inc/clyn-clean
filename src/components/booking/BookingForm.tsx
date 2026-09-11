"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SERVICE_TYPES,
  HOUSE_TYPES_FIXED,
  HOUSE_SIZES_APARTMENT,
  HOUSE_SIZE_LABEL,
  JIPJEONGRI_PACKAGES,
  JIPJEONGRI_SPACES,
  OCCUPANCY_STATUS_LABEL,
  VAT_NOTICE,
  EXTRA_SERVICE_NOTICE,
} from "@/lib/types";
import type { OccupancyStatus } from "@/lib/types";
import type { SelectedSlot } from "./ReservationCalendar";
import AgreementSection, { type AgreementState } from "./AgreementSection";
import WorkAreaInput, { type WorkAreaValue } from "./WorkAreaInput";
import DepositAccountPanel, { type DepositAccountInfo } from "./DepositAccountPanel";
import { bookingMaxDate, isWithinBookingWindow, outOfWindowMessage } from "@/lib/booking-window";

/**
 * 단계형 예약 폼.
 *
 * 흐름:
 *   1 서비스/주택유형/평형
 *   2 날짜/시간
 *   3 추가 서비스 / 현장정보 / 반려동물
 *   4 고객정보 (이름·연락처·작업지역)
 *   5 개인정보 동의 + 서비스 3종 동의
 *   6 최종 확인
 *   → 자동예약 가능 건만 예약금/계좌 확인
 *   → 상담 전환 건(40평 이상 / 반려동물 있음)은 상담접수 완료로 종료
 *
 * 금액은 서버가 단일 원천에서 계산한다. 클라이언트는 계산하지 않는다.
 */

interface OptionRow {
  option_key: string;
  option_label: string;
  price: number;
}

interface Quote {
  basePrice: number;
  estimatedTotal: number;
  depositAmount: number;
  priceConfirmed: boolean;
  notice: string;
  consultRequired: boolean;
  consultNotice: string | null;
  isStartingPrice: boolean;
  displayPriceLabel: string;
  optionBreakdown: { key: string; label: string; price: number; isConsult: boolean }[];
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type Result =
  | { kind: "deposit"; info: DepositAccountInfo }
  | { kind: "consultation"; code: string; notice: string };

const STEP_LABELS = ["서비스", "날짜", "현장정보", "고객정보", "동의", "확인"];

export default function BookingForm({ selectedSlot }: { selectedSlot: SelectedSlot | null }) {
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // 1단계
  const [serviceType, setServiceType] = useState<string>(SERVICE_TYPES[0]);
  const [houseTypeKey, setHouseTypeKey] = useState("");
  const [isApartment, setIsApartment] = useState(false);
  const [apartmentSize, setApartmentSize] = useState<number>(24);
  const [actualPyeong, setActualPyeong] = useState("");
  const [jipjeongriPackage, setJipjeongriPackage] = useState("1p4h");
  const [jipjeongriSpaces, setJipjeongriSpaces] = useState<string[]>([]);

  // 2단계
  const [desiredDate, setDesiredDate] = useState(selectedSlot?.date ?? "");
  const [timeSlot, setTimeSlot] = useState<string>(selectedSlot?.timeSlot ?? "");
  const [today, setToday] = useState("");
  // 예약 가능 최대일 — booking-window 단일 원천
  const maxDate = bookingMaxDate();

  // 3단계
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [extraOptions, setExtraOptions] = useState<string[]>([]);
  const [occupancyStatus, setOccupancyStatus] = useState<OccupancyStatus>("before_move_in");
  const [moveOutTime, setMoveOutTime] = useState("");
  const [moveInTime, setMoveInTime] = useState("");
  const [hasPet, setHasPet] = useState(false);
  const [petType, setPetType] = useState("");
  const [petCount, setPetCount] = useState("1");
  const [petHairSoil, setPetHairSoil] = useState("");
  const [petSmell, setPetSmell] = useState(false);
  const [petFeces, setPetFeces] = useState(false);
  const [petNote, setPetNote] = useState("");
  const [extraNotes, setExtraNotes] = useState("");

  // 4단계
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [area, setArea] = useState<WorkAreaValue>({ sido: "", sigungu: "", dong: "" });
  const [address, setAddress] = useState("");

  // 상담 전환 전용 동의 (서비스 3종과 분리)
  const [consultPrivacyAgreed, setConsultPrivacyAgreed] = useState(false);
  const [petConfirmed, setPetConfirmed] = useState<boolean | null>(null);

  // 5단계
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [agreement, setAgreement] = useState<AgreementState>({
    corePrinciplesAgreed: false,
    serviceTermsAgreed: false,
    additionalChargeAgreed: false,
  });

  // 견적
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const resolvedKey = isApartment
    ? apartmentSize === 40 ? "40평" : `${apartmentSize}평`
    : houseTypeKey;
  const entryRoute = selectedSlot ? "calendar" : "direct";
  const is40Plus = resolvedKey === "40평";

  // selectedSlot 동기화
  const [prevSlot, setPrevSlot] = useState(selectedSlot);
  if (selectedSlot !== prevSlot) {
    setPrevSlot(selectedSlot);
    setDesiredDate(selectedSlot?.date ?? "");
    setTimeSlot(selectedSlot?.timeSlot ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reservations")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setToday(d.today ?? ""); })
      .catch(() => {});
    fetch("/api/quote")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setOptions(d.options ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 서버 견적 조회 — 금액 계산은 전적으로 서버가 한다
  const fetchQuote = useCallback(async () => {
    if (serviceType !== "집정리" && !resolvedKey) { setQuote(null); return; }
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType,
          houseTypeKey: serviceType === "집정리" ? undefined : resolvedKey || undefined,
          jipjeongriPackage: serviceType === "집정리" ? jipjeongriPackage : undefined,
          actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
          extraOptions,
          entryRoute,
          desiredDate: desiredDate || undefined,
          timeSlot: timeSlot || undefined,
          hasPet,
        }),
      });
      const data = await res.json();
      setQuote(res.ok ? data.quote : null);
    } catch {
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }, [serviceType, resolvedKey, jipjeongriPackage, actualPyeong, extraOptions, entryRoute, desiredDate, timeSlot, hasPet]);

  // 견적은 입력이 바뀔 때마다 서버에서 다시 받아온다.
  // effect 내 동기 setState 경고를 피하기 위해 microtask로 넘긴다.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void fetchQuote(); });
    return () => { cancelled = true; };
  }, [fetchQuote]);

  const consultRequired = quote?.consultRequired === true;

  function toggle(list: string[], v: string) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function validateStep(s: Step): string | null {
    if (s === 1) {
      if (serviceType === "집정리") return null;
      if (!resolvedKey) return "주택유형을 선택해주세요.";
      if (is40Plus && !actualPyeong) return "공급면적을 입력해주세요.";
      return null;
    }
    if (s === 2) {
      if (!desiredDate) return "희망 날짜를 선택해주세요.";
      if (today && desiredDate < today) return "과거 날짜는 선택할 수 없습니다.";
      if (!isWithinBookingWindow(desiredDate)) return outOfWindowMessage();
      if (!timeSlot) return "오전 또는 오후를 선택해주세요.";
      return null;
    }
    if (s === 3) {
      if (serviceType === "사이청소") {
        if (!moveOutTime) return "기존 거주자 퇴거 완료 예정시간을 입력해주세요.";
        if (!moveInTime) return "신규 거주자 입주 예정시간을 입력해주세요.";
      }
      return null;
    }
    if (s === 4) {
      if (!customerName.trim()) return "예약자명을 입력해주세요.";
      if (!customerPhone.trim()) return "연락처를 입력해주세요.";
      if (!area.sido || !area.sigungu || !area.dong) return "작업 장소를 모두 선택해주세요.";
      // 상담 전환 건은 여기서 접수되므로 개인정보 동의를 실제로 받아야 한다.
      if (consultRequired) {
        if (petConfirmed === null) return "반려동물 여부를 확인해주세요.";
        if (!consultPrivacyAgreed) return "상담을 위한 개인정보 수집·이용에 동의해주세요.";
      }
      return null;
    }
    if (s === 5) {
      if (!privacyAgreed) return "개인정보 수집·이용에 동의해주세요.";
      if (petConfirmed === null) return "반려동물 여부를 확인해주세요.";
      if (!agreement.corePrinciplesAgreed) return "안내 핵심 원칙에 동의해주세요.";
      if (!agreement.serviceTermsAgreed) return "청소 서비스 이용 안내에 동의해주세요.";
      if (!agreement.additionalChargeAgreed) return "견적 및 추가요금 안내에 동의해주세요.";
      return null;
    }
    return null;
  }

  function next() {
    const v = validateStep(step);
    if (v) { setError(v); return; }
    setError(null);
    // 상담 전환 건은 동의 단계를 거치지 않고 고객정보까지만 받는다
    if (consultRequired && step === 4) { void submitConsultation(); return; }
    setStep((s) => Math.min(s + 1, 6) as Step);
  }
  function prev() { setError(null); setStep((s) => Math.max(s - 1, 1) as Step); }

  /**
   * 반려동물 최종 확인 — 이 값이 서버로 전달되는 hasPet의 source of truth다.
   * 3단계에서 "없음"을 골랐더라도 최종 확인에서 "있었음"을 선택하면
   * hasPet=true가 되어 서버가 상담으로 전환한다.
   */
  function confirmPet(v: boolean) {
    setPetConfirmed(v);
    setHasPet(v);
  }

  function buildPetMeta() {
    // hasPet은 최종 확인(confirmPet)과 항상 동기화된다.
    // 3단계 상세를 입력하지 않고 최종 확인에서만 "있었음"을 고른 경우에도
    // 상담 데이터에 반려동물 정보가 누락되지 않도록 기록한다.
    if (!hasPet) return null;
    return {
      hasPet: true,
      confirmedAtFinalStep: petConfirmed === true,
      type: petType || "미입력",
      count: petType || petHairSoil ? petCount : "미입력",
      hairSoil: petHairSoil || "미입력",
      smell: petSmell,
      feces: petFeces,
      note: petNote,
    };
  }

  async function submitConsultation() {
    // 클라이언트에서 동의하지 않은 값을 true로 만들어 보내지 않는다.
    if (!consultPrivacyAgreed) {
      setError("상담을 위한 개인정보 수집·이용에 동의해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName, customerPhone,
          areaSido: area.sido, areaSigungu: area.sigungu, areaDong: area.dong,
          address: address || undefined,
          serviceType,
          houseTypeKey: serviceType === "집정리" ? undefined : resolvedKey || undefined,
          actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
          preferredDate: desiredDate || undefined,
          preferredTimeSlot: timeSlot || undefined,
          // 40평과 반려동물이 동시에 해당하면 40평을 주 사유로 하되,
          // petMeta로 반려동물 정보를 함께 보존한다.
          reason: is40Plus ? "size_40_plus" : hasPet ? "pet" : "manual",
          petMeta: buildPetMeta(),
          extraNotes: extraNotes || undefined,
          privacyAgreed: consultPrivacyAgreed,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "상담 접수 중 오류가 발생했습니다."); return; }
      setResult({ kind: "consultation", code: data.requestCode, notice: data.notice });
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReservation() {
    setSubmitting(true);
    setError(null);
    try {
      const meta: Record<string, unknown> = {};
      const pet = buildPetMeta();
      if (pet) meta.pet = pet;
      if (serviceType === "사이청소") { meta.moveOutTime = moveOutTime; meta.moveInTime = moveInTime; }
      if (serviceType === "집정리") { meta.jipjeongriPackage = jipjeongriPackage; meta.jipjeongriSpaces = jipjeongriSpaces; }

      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName, customerPhone,
          customerEmail: customerEmail || undefined,
          serviceType,
          region: `${area.sido} ${area.sigungu}`.trim(),
          address: address || `${area.sido} ${area.sigungu} ${area.dong}`.trim(),
          areaSido: area.sido, areaSigungu: area.sigungu, areaDong: area.dong,
          houseTypeKey: serviceType === "집정리" ? undefined : resolvedKey || undefined,
          actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
          jipjeongriPackage: serviceType === "집정리" ? jipjeongriPackage : undefined,
          occupancyStatus,
          desiredDate, timeSlot, entryRoute,
          extraOptions,
          extraNotes: extraNotes + (Object.keys(meta).length ? `\n[내부메타] ${JSON.stringify(meta)}` : ""),
          depositorName: customerName,
          privacyAgreed,
          corePrinciplesAgreed: agreement.corePrinciplesAgreed,
          serviceTermsAgreed: agreement.serviceTermsAgreed,
          additionalChargeAgreed: agreement.additionalChargeAgreed,
          hasPet,
          petMeta: buildPetMeta(),
        }),
      });
      const data = await res.json();

      // 서버가 상담 전환으로 판정한 경우
      if (res.status === 409 && data.code === "CONSULT_REQUIRED") {
        setResult({ kind: "consultation", code: data.requestCode ?? "-", notice: data.notice ?? data.error });
        return;
      }
      if (!res.ok) { setError(data.error ?? "예약 처리 중 오류가 발생했습니다."); return; }

      // 계좌정보는 별도 엔드포인트에서만 받는다
      const code = data.reservation.reservation_code;
      const acc = await fetch(`/api/reservations/${code}/deposit-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: customerPhone }),
      });
      const accData = await acc.json();
      if (!acc.ok) { setError(accData.error ?? "예약금 계좌 안내 중 오류가 발생했습니다."); return; }
      setResult({ kind: "deposit", info: accData });
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 결과 화면 ───────────────────────────────────────────────────────────
  if (result?.kind === "deposit") return <DepositAccountPanel info={result.info} />;
  if (result?.kind === "consultation") {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-7 text-center shadow-sm md:p-10">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--mint-soft)] text-2xl text-[var(--mint)]">✓</div>
        <h3 className="font-display text-xl font-bold">상담 접수가 완료되었습니다</h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">접수번호 <strong className="text-[var(--ink)]">{result.code}</strong></p>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--ink-soft)]">{result.notice}</p>
      </div>
    );
  }

  // ── 단계형 폼 ───────────────────────────────────────────────────────────
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-5 shadow-sm md:p-8">
      {/* 진행 표시 */}
      <ol className="mb-6 flex items-center gap-1 overflow-x-auto pb-1">
        {STEP_LABELS.map((label, i) => {
          const n = (i + 1) as Step;
          const active = n === step;
          const done = n < step;
          return (
            <li key={label} className="flex shrink-0 items-center gap-1">
              <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                active ? "bg-[var(--navy)] text-white"
                : done ? "bg-[var(--mint-soft)] text-[var(--mint)]"
                : "bg-[var(--sand-deep)] text-[var(--ink-soft)]"}`}>
                {done ? "✓" : n}
              </span>
              <span className={`text-[11px] font-medium ${active ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"}`}>{label}</span>
              {i < STEP_LABELS.length - 1 && <span className="mx-0.5 text-[var(--line)]">·</span>}
            </li>
          );
        })}
      </ol>

      {/* 상담 전환 안내 */}
      {consultRequired && quote?.consultNotice && (
        <div className="mb-5 rounded-xl bg-[#FBE9D3] p-4 text-sm leading-relaxed text-[var(--amber)]">
          {quote.consultNotice}
        </div>
      )}

      {/* ── 1단계 ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-semibold">청소 종류</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SERVICE_TYPES.map((s) => (
                <button key={s} type="button"
                  onClick={() => { setServiceType(s); setHouseTypeKey(""); setIsApartment(false); }}
                  className={`min-h-[48px] rounded-xl border text-sm font-medium transition ${
                    serviceType === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {serviceType === "집정리" ? (
            <>
              <div>
                <label className="mb-2 block text-sm font-semibold">인원 패키지</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {JIPJEONGRI_PACKAGES.map((p) => (
                    <button key={p.key} type="button" onClick={() => setJipjeongriPackage(p.key)}
                      className={`min-h-[48px] rounded-xl border text-sm font-medium ${
                        jipjeongriPackage === p.key ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--ink-soft)]">추가 1인 / 1시간 — 30,000원. 폐기물·폐기차 비용은 현장 확인 후 별도 안내드립니다.</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">정리 공간 (선택)</label>
                <div className="flex flex-wrap gap-2">
                  {JIPJEONGRI_SPACES.map((s) => (
                    <button key={s} type="button" onClick={() => setJipjeongriSpaces((v) => toggle(v, s))}
                      className={`min-h-[40px] rounded-full border px-4 text-sm font-medium ${
                        jipjeongriSpaces.includes(s) ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-2 block text-sm font-semibold">주택 유형</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {HOUSE_TYPES_FIXED.map((t) => (
                    <button key={t} type="button" onClick={() => { setHouseTypeKey(t); setIsApartment(false); }}
                      className={`min-h-[48px] rounded-xl border text-sm font-medium ${
                        !isApartment && houseTypeKey === t ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                      {t}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setIsApartment(true); setHouseTypeKey(""); }}
                    className={`col-span-2 min-h-[48px] rounded-xl border text-sm font-medium sm:col-span-3 ${
                      isApartment ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    아파트 / 주택
                  </button>
                </div>
              </div>

              {isApartment && (
                <div>
                  <label className="mb-2 block text-sm font-semibold">평형</label>
                  <div className="grid grid-cols-4 gap-2">
                    {HOUSE_SIZES_APARTMENT.map((sz) => (
                      <button key={sz} type="button" onClick={() => setApartmentSize(sz)}
                        className={`min-h-[44px] rounded-xl border text-sm font-medium ${
                          apartmentSize === sz ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                        {HOUSE_SIZE_LABEL[sz]}
                      </button>
                    ))}
                  </div>
                  {is40Plus && (
                    <div className="mt-3">
                      <label className="mb-1.5 block text-sm font-semibold">공급면적 (평)</label>
                      <input type="number" value={actualPyeong} onChange={(e) => setActualPyeong(e.target.value)}
                        placeholder="예: 52" min={40}
                        className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 2단계 ── */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">희망 날짜 <span className="text-xs text-[var(--rose)]">*필수</span></label>
            <input type="date" value={desiredDate} min={today} max={maxDate} onChange={(e) => setDesiredDate(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
            <p className="mt-1.5 text-xs text-[var(--ink-soft)]">
              오늘부터 {maxDate}까지 예약할 수 있습니다.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold">시간대 <span className="text-xs text-[var(--rose)]">*필수</span></label>
            <div className="flex gap-3">
              {(["morning", "afternoon"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setTimeSlot(s)}
                  className={`min-h-[52px] flex-1 rounded-xl border text-sm font-medium ${
                    timeSlot === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {s === "morning" ? "오전" : "오후"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 3단계 ── */}
      {step === 3 && (
        <div className="space-y-5">
          {serviceType !== "집정리" && (
            <div>
              <label className="mb-2 block text-sm font-semibold">입주 상태</label>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(OCCUPANCY_STATUS_LABEL) as [OccupancyStatus, string][]).map(([k, v]) => (
                  <button key={k} type="button" onClick={() => setOccupancyStatus(k)}
                    className={`min-h-[44px] rounded-full border px-4 text-sm font-medium ${
                      occupancyStatus === k ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {serviceType === "사이청소" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-semibold">퇴거 완료 예정시간</label>
                <input type="datetime-local" value={moveOutTime} onChange={(e) => setMoveOutTime(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold">입주 예정시간</label>
                <input type="datetime-local" value={moveInTime} onChange={(e) => setMoveInTime(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
              </div>
            </div>
          )}

          {/* 추가 서비스 (선택) */}
          {options.length > 0 && serviceType !== "집정리" && (
            <div>
              <label className="mb-2 block text-sm font-semibold">추가 서비스 (선택)</label>
              <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                  <button key={o.option_key} type="button"
                    onClick={() => setExtraOptions((v) => toggle(v, o.option_key))}
                    className={`min-h-[40px] rounded-full border px-4 text-sm font-medium transition ${
                      extraOptions.includes(o.option_key) ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    {o.option_label}
                    {o.price > 0 && <span className="ml-1 text-xs">+{o.price.toLocaleString("ko-KR")}원</span>}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--ink-soft)]">{EXTRA_SERVICE_NOTICE}</p>
            </div>
          )}

          {/* 반려동물 */}
          <div>
            <label className="mb-2 block text-sm font-semibold">반려동물</label>
            <div className="flex gap-3">
              {([false, true] as const).map((v) => (
                <button key={String(v)} type="button" onClick={() => setHasPet(v)}
                  className={`min-h-[48px] flex-1 rounded-xl border text-sm font-medium ${
                    hasPet === v ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {v ? "있음" : "없음"}
                </button>
              ))}
            </div>
            {hasPet && (
              <div className="mt-3 space-y-3 rounded-xl border border-[var(--line)] p-4">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">종류</p>
                  <div className="flex gap-2">
                    {[["dog", "반려견"], ["cat", "반려묘"], ["other", "기타"]].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setPetType(v)}
                        className={`min-h-[36px] rounded-full border px-3 text-xs font-medium ${
                          petType === v ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">마리 수</p>
                    <select value={petCount} onChange={(e) => setPetCount(e.target.value)}
                      className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
                      {["1", "2", "3", "4이상"].map((n) => <option key={n} value={n}>{n}마리</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">털 오염 정도</p>
                    <select value={petHairSoil} onChange={(e) => setPetHairSoil(e.target.value)}
                      className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
                      <option value="">선택</option>
                      <option value="없음">거의 없음</option>
                      <option value="보통">보통</option>
                      <option value="심함">심함</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={petSmell} onChange={(e) => setPetSmell(e.target.checked)} className="h-4 w-4 rounded" />
                    냄새 있음
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={petFeces} onChange={(e) => setPetFeces(e.target.checked)} className="h-4 w-4 rounded" />
                    배변 오염 있음
                  </label>
                </div>
                <textarea value={petNote} onChange={(e) => setPetNote(e.target.value)} rows={2}
                  placeholder="기타 오염 상태나 특이사항"
                  className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold">기타 요청사항</label>
            <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} rows={3}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
          </div>
        </div>
      )}

      {/* ── 4단계 ── */}
      {step === 4 && (
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="예약자명" required value={customerName} onChange={setCustomerName} />
          <Field label="연락처" required value={customerPhone} onChange={setCustomerPhone} placeholder="010-0000-0000" />
          <div className="md:col-span-2"><WorkAreaInput value={area} onChange={setArea} /></div>
          <div className="md:col-span-2"><Field label="상세 주소 (선택)" value={address} onChange={setAddress} /></div>
          <div className="md:col-span-2"><Field label="이메일 (선택)" value={customerEmail} onChange={setCustomerEmail} type="email" /></div>

          {/* 상담 전환 건은 이 단계에서 접수되므로 동의를 실제로 받는다 */}
          {consultRequired && (
            <div className="space-y-4 md:col-span-2">
              <div className="rounded-2xl border border-[var(--line)] p-4">
                <p className="mb-2 text-sm font-semibold">
                  반려동물 확인 <span className="text-xs text-[var(--rose)]">*필수</span>
                </p>
                <div className="flex gap-3">
                  {([true, false] as const).map((v) => (
                    <button key={String(v)} type="button" onClick={() => confirmPet(v)}
                      className={`min-h-[48px] flex-1 rounded-xl border text-sm font-medium ${
                        petConfirmed === v ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                      {v ? "있었음" : "관련없음"}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--ink-soft)]">
                  반려동물이 있었던 공간은 추가 확인이 필요해 상담으로 안내드립니다.
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[var(--sand-deep)] p-4">
                <input type="checkbox" checked={consultPrivacyAgreed}
                  onChange={(e) => setConsultPrivacyAgreed(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded" />
                <span className="text-sm leading-relaxed">
                  <span className="font-medium text-[var(--rose)]">[필수]</span> 상담 안내를 위한 개인정보
                  수집·이용에 동의합니다.{" "}
                  <a href="/privacy" target="_blank" className="text-[var(--mint)] underline">개인정보처리방침</a>
                </span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* ── 5단계 ── */}
      {step === 5 && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[var(--line)] p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded" />
              <span className="text-sm">
                <span className="text-[var(--rose)]">[필수]</span> 개인정보 수집·이용에 동의합니다.{" "}
                <a href="/privacy" target="_blank" className="text-[var(--mint)] underline">개인정보처리방침</a>
              </span>
            </label>
          </div>
          <div className="rounded-2xl border border-[var(--line)] p-4">
            <p className="mb-2 text-sm font-semibold">
              반려동물 확인 <span className="text-xs text-[var(--rose)]">*필수</span>
            </p>
            <div className="flex gap-3">
              {([true, false] as const).map((v) => (
                <button key={String(v)} type="button" onClick={() => confirmPet(v)}
                  className={`min-h-[48px] flex-1 rounded-xl border text-sm font-medium ${
                    petConfirmed === v ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {v ? "있었음" : "관련없음"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              반려동물이 있었던 공간은 추가 확인이 필요해 상담으로 안내드립니다.
            </p>
          </div>

          <AgreementSection value={agreement} onChange={setAgreement} />
        </div>
      )}

      {/* ── 6단계 ── */}
      {step === 6 && (
        <div className="space-y-5">
          <div className="rounded-2xl border-2 border-[var(--mint)] bg-[var(--mint-soft)] p-5">
            <p className="mb-2 text-sm font-bold text-[var(--mint)]">Clyn Clean 자동견적</p>
            {quoteLoading ? (
              <p className="text-sm text-[var(--ink-soft)]">견적 계산 중...</p>
            ) : quote ? (
              <>
                <p className="font-display text-2xl font-bold text-[var(--ink)]">
                  예상 견적 {quote.displayPriceLabel}
                </p>
                <p className="mt-2 text-xs text-[var(--ink-soft)]">{VAT_NOTICE}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{EXTRA_SERVICE_NOTICE}</p>
              </>
            ) : (
              <p className="text-sm text-[var(--ink-soft)]">견적을 불러올 수 없습니다.</p>
            )}
          </div>

          <dl className="space-y-1.5 rounded-2xl border border-[var(--line)] p-5 text-sm">
            <SummaryRow label="청소 종류" value={serviceType} />
            {serviceType !== "집정리" && <SummaryRow label="주택유형" value={resolvedKey === "40평" ? "40평 이상" : resolvedKey} />}
            <SummaryRow label="희망 날짜" value={desiredDate} />
            <SummaryRow label="시간대" value={timeSlot === "morning" ? "오전" : "오후"} />
            <SummaryRow label="예약자" value={customerName} />
            <SummaryRow label="작업 장소" value={`${area.sido} ${area.sigungu} ${area.dong}`} />
            {extraOptions.length > 0 && (
              <SummaryRow label="추가 서비스" value={extraOptions.map((k) => options.find((o) => o.option_key === k)?.option_label ?? k).join(", ")} />
            )}
          </dl>
        </div>
      )}

      {error && <div className="mt-4 rounded-lg bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">{error}</div>}

      {/* 네비게이션 */}
      <div className="mt-6 flex gap-3">
        {step > 1 && (
          <button type="button" onClick={prev}
            className="min-h-[52px] rounded-full border border-[var(--line)] px-6 text-sm font-semibold text-[var(--ink-soft)]">
            이전
          </button>
        )}
        {step < 6 ? (
          <button type="button" onClick={next} disabled={submitting}
            className="min-h-[52px] flex-1 rounded-full bg-[var(--navy)] text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-50">
            {submitting ? "처리 중..." : consultRequired && step === 4 ? "상담 접수하기" : "다음"}
          </button>
        ) : (
          <button type="button" onClick={submitReservation} disabled={submitting}
            className="min-h-[52px] flex-1 rounded-full bg-[var(--navy)] text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-50">
            {submitting ? "접수 중..." : "예약 신청 완료"}
          </button>
        )}
      </div>
      {step === 6 && (
        <p className="mt-2 text-center text-xs text-[var(--ink-soft)]">
          신청 후 예약금 입금 계좌를 안내드립니다. 입금 확인 후 담당자가 예약을 확정합니다.
        </p>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold">
        {label} {required && <span className="text-xs text-[var(--rose)]">*필수</span>}
      </label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--ink-soft)]">{label}</dt>
      <dd className="text-right font-medium">{value || "-"}</dd>
    </div>
  );
}
