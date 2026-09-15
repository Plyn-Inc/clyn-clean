"use client";

import { useEffect, useState } from "react";
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
  serviceLabel,
} from "@/lib/types";
import type { OccupancyStatus } from "@/lib/types";
import type { SelectedSlot } from "./ReservationCalendar";
import AgreementSection, { type AgreementState } from "./AgreementSection";
import RegionSelect, { EMPTY_REGION, type RegionValue } from "./RegionSelect";
import DepositAccountPanel, { type DepositAccountInfo } from "./DepositAccountPanel";
import { bookingMaxDate, isWithinBookingWindow, outOfWindowMessage } from "@/lib/booking-window";
import { callApi } from "@/lib/error-messages";

/**
 * 고객 예약 4단계.
 * 1 서비스 → 2 날짜 → 3 고객정보 → 4 확인·동의 → 예약 선금 안내
 *
 * 사이청소는 오전/오후를 선택하지 않고 날짜 + 퇴거/입주 시간으로 접수한다.
 * 신규 사이청소의 time_slot은 all_day로 저장되어 해당 날짜를 우선 보호한다.
 */
interface Quote {
  basePrice: number;
  estimatedTotal: number;
  depositAmount: number;
  estimatedBalance: number;
  priceConfirmed: boolean;
  notice: string;
  consultRequired: boolean;
  consultNotice: string | null;
  isStartingPrice: boolean;
  displayPriceLabel: string;
  optionBreakdown: { key: string; label: string; price: number; isConsult: boolean }[];
}

type Step = 1 | 2 | 3 | 4;
type BookingTimeSlot = "" | "morning" | "afternoon" | "all_day";
type Result =
  | { kind: "deposit"; info: DepositAccountInfo }
  | { kind: "consultation"; code: string; notice: string };

const STEP_LABELS = ["서비스", "날짜", "고객정보", "확인·동의"];

interface BookingFormProps {
  selectedSlot: SelectedSlot | null;
  selectedDate?: string | null;
  onServiceChange?: (serviceType: string) => void;
}

export default function BookingForm({ selectedSlot, selectedDate, onServiceChange }: BookingFormProps) {
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // 1단계 — 서비스
  const [serviceType, setServiceType] = useState<string>(SERVICE_TYPES[0]);
  const [houseTypeKey, setHouseTypeKey] = useState("");
  const [isApartment, setIsApartment] = useState(false);
  const [apartmentSize, setApartmentSize] = useState<number>(24);
  const [actualPyeong, setActualPyeong] = useState("");
  const [jipjeongriPackage, setJipjeongriPackage] = useState("1p4h");
  const [jipjeongriSpaces, setJipjeongriSpaces] = useState<string[]>([]);

  // 2단계 — 날짜/시간
  const [desiredDate, setDesiredDate] = useState(selectedDate ?? selectedSlot?.date ?? "");
  const [timeSlot, setTimeSlot] = useState<BookingTimeSlot>(selectedSlot?.timeSlot ?? "");
  const [moveOutTime, setMoveOutTime] = useState("");
  const [moveInTime, setMoveInTime] = useState("");
  const [today, setToday] = useState("");
  const maxDate = bookingMaxDate();

  // 3단계 — 고객정보 + 기존 현장정보 통합
  const [occupancyStatus, setOccupancyStatus] = useState<OccupancyStatus>("before_move_in");
  const [extraNotes, setExtraNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [region, setRegion] = useState<RegionValue>(EMPTY_REGION);
  const [regionMasterImported, setRegionMasterImported] = useState<boolean | null>(null);
  const [manualAreaText, setManualAreaText] = useState("");
  const [address, setAddress] = useState("");

  // 4단계 — 확인/동의
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [agreement, setAgreement] = useState<AgreementState>({
    corePrinciplesAgreed: false,
    serviceTermsAgreed: false,
    additionalChargeAgreed: false,
  });

  // 견적
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(false);

  const resolvedKey = isApartment
    ? apartmentSize === 40 ? "40평" : `${apartmentSize}평`
    : houseTypeKey;
  const entryRoute = selectedSlot || selectedDate ? "calendar" : "direct";
  const is40Plus = resolvedKey === "40평";
  const regionConsultRequired = region.serviceAvailable === false || regionMasterImported === false;
  const consultRequired = quote?.consultRequired === true || regionConsultRequired;

  useEffect(() => {
    if (serviceType === "사이청소") {
      if (!selectedDate) return;
      setDesiredDate(selectedDate);
      setTimeSlot("all_day");
      return;
    }
    if (!selectedSlot) return;
    setDesiredDate(selectedSlot.date);
    setTimeSlot(selectedSlot.timeSlot);
  }, [selectedSlot, selectedDate, serviceType]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reservations")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setToday(d.today ?? ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 최신 견적 요청만 화면 상태를 갱신한다.
  // 이전 요청은 abort하여 서비스/평형을 빠르게 바꿀 때 오래된 응답이 덮어쓰지 않게 한다.
  useEffect(() => {
    const hasProduct = serviceType === "집정리" || !!resolvedKey;
    if (!hasProduct) {
      void Promise.resolve().then(() => {
        setQuote(null);
        setQuoteError(false);
        setQuoteLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setQuoteError(false);
      setQuoteLoading(true);
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            serviceType,
            houseTypeKey: serviceType === "집정리" ? undefined : resolvedKey || undefined,
            jipjeongriPackage: serviceType === "집정리" ? jipjeongriPackage : undefined,
            actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
            entryRoute,
            desiredDate: desiredDate || undefined,
            timeSlot: serviceType === "사이청소" ? "all_day" : timeSlot || undefined,
          }),
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setQuote(null);
          setQuoteError(true);
          return;
        }
        setQuote(data.quote ?? null);
        setQuoteError(!data.quote);
      } catch {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError(true);
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    });

    return () => controller.abort();
  }, [serviceType, resolvedKey, jipjeongriPackage, actualPyeong, entryRoute, desiredDate, timeSlot]);

  function toggle(list: string[], v: string) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function selectService(nextService: string) {
    onServiceChange?.(nextService);
    setServiceType(nextService);
    setDesiredDate("");
    setMoveOutTime("");
    setMoveInTime("");
    setHouseTypeKey("");
    setIsApartment(false);
    setError(null);
    if (nextService === "사이청소") {
      setTimeSlot("all_day");
    } else {
      setTimeSlot(selectedSlot?.timeSlot ?? "");
    }
  }

  function betweenCleaningDateTime(time: string): string | undefined {
    if (!desiredDate || !time) return undefined;
    return `${desiredDate}T${time}`;
  }

  function validateStep(s: Step): string | null {
    if (s === 1) {
      if (serviceType !== "집정리") {
        if (!resolvedKey) return "주택유형을 선택해주세요.";
        if (is40Plus && !actualPyeong) return "공급면적을 입력해주세요.";
      }
      if (quoteLoading) return "가격 정보를 확인 중입니다. 잠시만 기다려주세요.";
      if (!quote) return "가격 정보를 불러온 후 진행해주세요.";
      return null;
    }

    if (s === 2) {
      if (!desiredDate) return "희망 날짜를 선택해주세요.";
      if (today && desiredDate < today) return "과거 날짜는 선택할 수 없습니다.";
      if (!isWithinBookingWindow(desiredDate)) return outOfWindowMessage();

      if (serviceType === "사이청소") {
        if (!moveOutTime) return "기존 거주자 퇴거 완료 예정시간을 입력해주세요.";
        if (!moveInTime) return "새 입주자 입주 예정시간을 입력해주세요.";
        if (moveOutTime >= moveInTime) {
          return "새 입주자 입주 예정시간은 퇴거 완료 예정시간보다 이후여야 합니다.";
        }
        return null;
      }

      if (timeSlot !== "morning" && timeSlot !== "afternoon") {
        return "오전 또는 오후를 선택해주세요.";
      }
      return null;
    }

    if (s === 3) {
      if (!customerName.trim()) return "예약자명을 입력해주세요.";
      if (!customerPhone.trim()) return "연락처를 입력해주세요.";
      if (regionMasterImported === false) {
        if (!manualAreaText.trim()) return "상담을 위해 희망 작업지역을 입력해주세요.";
        return null;
      }
      if (!region.sidoCode) return "시/도를 선택해주세요.";
      if (!region.sigunguCode && !region.dongCode) return "지역을 선택해주세요.";
      if (region.sigunguCode && !region.dongCode) return "읍/면/동을 선택해주세요.";
      return null;
    }

    if (!privacyAgreed) return "개인정보 수집·이용에 동의해주세요.";
    if (consultRequired) return null;
    if (!agreement.corePrinciplesAgreed) return "안내 핵심 원칙에 동의해주세요.";
    if (!agreement.serviceTermsAgreed) return "청소 서비스 이용 안내에 동의해주세요.";
    if (!agreement.additionalChargeAgreed) return "견적 및 추가요금 안내에 동의해주세요.";
    return null;
  }

  async function next() {
    const v = validateStep(step);
    if (v) {
      setError(v);
      return;
    }
    setError(null);

    if (step < 4) {
      setStep((s) => Math.min(s + 1, 4) as Step);
      return;
    }

    if (consultRequired) await submitConsultation();
    else await submitReservation();
  }

  function prev() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1) as Step);
  }

  async function submitConsultation() {
    if (!privacyAgreed) {
      setError("상담을 위한 개인정보 수집·이용에 동의해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const consultationNotes = extraNotes.trim() ||
      (regionConsultRequired
        ? "서비스 가능지역 확인이 필요한 온라인 예약 건입니다."
        : "온라인 예약 과정에서 상담이 필요한 건입니다.");

    const outcome = await callApi<{ requestCode: string; notice: string }>("/api/consultations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName,
        customerPhone,
        areaSido: region.sidoName,
        areaSigungu: region.sigunguName,
        areaDong: region.dongName,
        areaText: regionMasterImported === false ? manualAreaText.trim() : undefined,
        address: address || undefined,
        serviceType,
        houseTypeKey: serviceType === "집정리" ? undefined : resolvedKey || undefined,
        actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
        preferredDate: desiredDate || undefined,
        preferredTimeSlot: serviceType === "사이청소" ? "all_day" : timeSlot || undefined,
        reason: is40Plus ? "size_40_plus" : quote?.consultRequired ? "price_unconfirmed" : "manual",
        extraNotes: consultationNotes,
        jipjeongriInfo: serviceType === "집정리"
          ? [jipjeongriPackage, ...jipjeongriSpaces].filter(Boolean).join(", ")
          : undefined,
        privacyAgreed,
      }),
    });

    if (outcome.kind !== "success") {
      setError(outcome.message);
      setSubmitting(false);
      return;
    }
    setResult({ kind: "consultation", code: outcome.data.requestCode, notice: outcome.data.notice });
    setSubmitting(false);
  }

  async function submitReservation() {
    setSubmitting(true);
    setError(null);

    const reservationTimeSlot: BookingTimeSlot = serviceType === "사이청소" ? "all_day" : timeSlot;
    const outcome = await callApi<{ reservation: { reservation_code: string } }>("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        serviceType,
        region: `${region.sidoName} ${region.sigunguName}`.trim(),
        address: address || [region.sidoName, region.sigunguName, region.dongName].filter(Boolean).join(" "),
        areaSido: region.sidoName,
        areaSigungu: region.sigunguName,
        areaDong: region.dongName,
        areaSidoCode: region.sidoCode || undefined,
        areaSigunguCode: region.sigunguCode || undefined,
        areaDongCode: region.dongCode || undefined,
        houseTypeKey: serviceType === "집정리" ? undefined : resolvedKey || undefined,
        actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
        jipjeongriPackage: serviceType === "집정리" ? jipjeongriPackage : undefined,
        occupancyStatus:
          serviceType === "사이청소" || serviceType === "집정리" ? undefined : occupancyStatus,
        desiredDate,
        timeSlot: reservationTimeSlot,
        entryRoute,
        moveOutTime: serviceType === "사이청소" ? betweenCleaningDateTime(moveOutTime) : undefined,
        moveInTime: serviceType === "사이청소" ? betweenCleaningDateTime(moveInTime) : undefined,
        extraNotes: extraNotes || undefined,
        depositorName: customerName,
        privacyAgreed,
        corePrinciplesAgreed: agreement.corePrinciplesAgreed,
        serviceTermsAgreed: agreement.serviceTermsAgreed,
        additionalChargeAgreed: agreement.additionalChargeAgreed,
        clientEstimatedTotal: quote?.priceConfirmed ? quote.estimatedTotal : undefined,
      }),
    });

    if (
      outcome.kind === "serverError" &&
      outcome.status === 409 &&
      outcome.body?.code === "CONSULT_REQUIRED"
    ) {
      const b = outcome.body as { requestCode?: string; notice?: string; error?: string };
      setResult({
        kind: "consultation",
        code: b.requestCode ?? "-",
        notice: b.notice ?? b.error ?? "",
      });
      setSubmitting(false);
      return;
    }

    if (outcome.kind !== "success") {
      setError(outcome.message);
      setSubmitting(false);
      return;
    }

    const code = outcome.data.reservation.reservation_code;
    const acc = await callApi<DepositAccountInfo>(`/api/reservations/${code}/deposit-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: customerPhone }),
    });
    if (acc.kind !== "success") {
      setError(acc.message);
      setSubmitting(false);
      return;
    }
    setResult({ kind: "deposit", info: acc.data });
    setSubmitting(false);
  }

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

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-5 shadow-sm md:p-8">
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

      {consultRequired && (quote?.consultNotice || regionConsultRequired) && (
        <div className="mb-5 rounded-xl bg-[#FBE9D3] p-4 text-sm leading-relaxed text-[var(--amber)]">
          {regionConsultRequired
            ? "선택하신 지역은 직접 예약이 어려워 상담 접수로 진행됩니다."
            : quote?.consultNotice}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-semibold">청소 종류</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SERVICE_TYPES.map((s) => (
                <button key={s} type="button"
                  onClick={() => selectService(s)}
                  className={`min-h-[48px] rounded-xl border text-sm font-medium transition ${
                    serviceType === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {serviceLabel(s)}
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

          {(resolvedKey || serviceType === "집정리") && (
            <div className="rounded-2xl border-2 border-[var(--mint)] bg-[var(--mint-soft)] p-5">
              {quoteLoading ? (
                <p className="text-sm text-[var(--ink-soft)]">가격을 불러오는 중...</p>
              ) : quote ? (
                <>
                  <p className="text-xs font-semibold text-[var(--mint)]">
                    {serviceLabel(serviceType)} · {resolvedKey === "40평" ? "40평 이상" : resolvedKey || "집정리"}
                  </p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-[var(--ink)]">{quote.displayPriceLabel}</p>
                  <p className="mt-2 text-xs text-[var(--ink-soft)]">{VAT_NOTICE}</p>
                  {quote.consultRequired && quote.consultNotice ? (
                    <p className="mt-2 text-xs leading-relaxed text-[var(--amber)]">{quote.consultNotice}</p>
                  ) : (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">날짜를 선택하면 최종 예약금액이 확정됩니다.</p>
                  )}
                </>
              ) : quoteError ? (
                <p className="text-sm text-[var(--ink-soft)]">가격 정보를 불러올 수 없습니다. 다시 선택해주세요.</p>
              ) : (
                <p className="text-sm text-[var(--ink-soft)]">가격 정보를 확인 중입니다.</p>
              )}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">희망 날짜 <span className="text-xs text-[var(--rose)]">*필수</span></label>
            <input type="date" value={desiredDate} min={today} max={maxDate} onChange={(e) => setDesiredDate(e.target.value)}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
            <p className="mt-1.5 text-xs text-[var(--ink-soft)]">오늘부터 {maxDate}까지 예약할 수 있습니다.</p>
          </div>

          {serviceType === "사이청소" ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-[var(--mint-soft)] p-4 text-xs leading-relaxed text-[var(--mint)]">
                사이청소는 오전/오후를 선택하지 않습니다. 퇴거 완료 후 새 입주 전까지의 실제 작업 가능 시간을 입력해주세요.
                접수되면 해당 날짜는 우선 보호되며, 확인 후 관리자가 남는 시간대를 다시 열 수 있습니다.
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">퇴거 완료 예정시간 <span className="text-xs text-[var(--rose)]">*필수</span></label>
                  <input type="time" value={moveOutTime} onChange={(e) => setMoveOutTime(e.target.value)}
                    className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">새 입주 예정시간 <span className="text-xs text-[var(--rose)]">*필수</span></label>
                  <input type="time" value={moveInTime} onChange={(e) => setMoveInTime(e.target.value)}
                    className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
                </div>
              </div>
            </div>
          ) : (
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
          )}

          {desiredDate && quote && !quote.consultRequired && (
            <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-semibold text-[var(--ink-soft)]">최종 예약금액</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-[var(--ink)]">{quote.estimatedTotal.toLocaleString("ko-KR")}원</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <SummaryRow label="예약 선금" value={`${quote.depositAmount.toLocaleString("ko-KR")}원`} />
                <SummaryRow label="잔금" value={`${quote.estimatedBalance.toLocaleString("ko-KR")}원`} />
              </div>
              <p className="mt-2 text-xs text-[var(--ink-soft)]">{VAT_NOTICE}</p>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="예약자명" required value={customerName} onChange={setCustomerName} />
          <Field label="연락처" required value={customerPhone} onChange={setCustomerPhone} placeholder="010-0000-0000" />
          <div className="md:col-span-2">
            <RegionSelect
              value={region}
              onChange={setRegion}
              onImportedChange={setRegionMasterImported}
            />
          </div>
          {regionMasterImported === false && (
            <div className="md:col-span-2 space-y-3 rounded-xl border border-[#E8C89B] bg-[#FFF7EA] p-4 text-sm leading-relaxed text-[var(--ink-soft)]">
              <div>
                <p className="font-semibold text-[var(--ink)]">현재는 상담 접수로 전환됩니다.</p>
                <p className="mt-1">행정구역 데이터가 준비되기 전에는 직접 예약을 열지 않습니다. 이 4단계 안에서 상담 접수까지 완료할 수 있습니다.</p>
              </div>
              <Field
                label="희망 작업지역"
                required
                value={manualAreaText}
                onChange={setManualAreaText}
                placeholder="예: 서울 강남구 역삼동"
              />
            </div>
          )}
          <div className="md:col-span-2"><Field label="상세 주소 (선택)" value={address} onChange={setAddress} /></div>
          <div className="md:col-span-2"><Field label="이메일 (선택)" value={customerEmail} onChange={setCustomerEmail} type="email" /></div>

          {serviceType !== "사이청소" && serviceType !== "집정리" && (
            <div className="md:col-span-2">
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

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold">기타 요청사항</label>
            <textarea value={extraNotes} onChange={(e) => setExtraNotes(e.target.value)} rows={3}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <div className="rounded-2xl border-2 border-[var(--mint)] bg-[var(--mint-soft)] p-5">
            <p className="mb-2 text-sm font-bold text-[var(--mint)]">예약 내용 확인</p>
            {quoteLoading ? (
              <p className="text-sm text-[var(--ink-soft)]">견적 계산 중...</p>
            ) : quote ? (
              <>
                <p className="font-display text-2xl font-bold text-[var(--ink)]">{quote.displayPriceLabel}</p>
                {!consultRequired && (
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <SummaryRow label="총 예약금액" value={`${quote.estimatedTotal.toLocaleString("ko-KR")}원`} />
                    <SummaryRow label="예약 선금" value={`${quote.depositAmount.toLocaleString("ko-KR")}원`} />
                    <SummaryRow label="남은 잔금" value={`${quote.estimatedBalance.toLocaleString("ko-KR")}원`} />
                  </dl>
                )}
                <p className="mt-2 text-xs text-[var(--ink-soft)]">{VAT_NOTICE}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{EXTRA_SERVICE_NOTICE}</p>
              </>
            ) : quoteError ? (
              <p className="text-sm text-[var(--ink-soft)]">가격 정보를 불러올 수 없습니다. 다시 선택해주세요.</p>
            ) : (
              <p className="text-sm text-[var(--ink-soft)]">가격 정보를 확인 중입니다.</p>
            )}
          </div>

          <dl className="space-y-1.5 rounded-2xl border border-[var(--line)] p-5 text-sm">
            <SummaryRow label="청소 종류" value={serviceLabel(serviceType)} />
            {serviceType !== "집정리" && <SummaryRow label="주택유형" value={resolvedKey === "40평" ? "40평 이상" : resolvedKey} />}
            <SummaryRow label="희망 날짜" value={desiredDate} />
            {serviceType === "사이청소" ? (
              <>
                <SummaryRow label="퇴거 완료" value={moveOutTime} />
                <SummaryRow label="새 입주" value={moveInTime} />
              </>
            ) : (
              <SummaryRow label="시간대" value={timeSlot === "morning" ? "오전" : "오후"} />
            )}
            <SummaryRow label="예약자" value={customerName} />
            <SummaryRow label="작업 장소" value={regionMasterImported === false ? manualAreaText : [region.sidoName, region.sigunguName, region.dongName].filter(Boolean).join(" ")} />
            {serviceType !== "사이청소" && serviceType !== "집정리" && (
              <SummaryRow label="입주 상태" value={OCCUPANCY_STATUS_LABEL[occupancyStatus]} />
            )}
          </dl>

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

          {!consultRequired && <AgreementSection value={agreement} onChange={setAgreement} />}
        </div>
      )}

      {error && <div className="mt-4 rounded-lg bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">{error}</div>}

      <div className="mt-6 flex gap-3">
        {step > 1 && (
          <button type="button" onClick={prev}
            className="min-h-[52px] rounded-full border border-[var(--line)] px-6 text-sm font-semibold text-[var(--ink-soft)]">
            이전
          </button>
        )}
        <button type="button" onClick={() => void next()} disabled={submitting}
          className="min-h-[52px] flex-1 rounded-full bg-[var(--navy)] text-sm font-semibold text-white transition hover:bg-[var(--navy-deep)] disabled:opacity-50">
          {submitting
            ? (consultRequired ? "상담 접수 중..." : "예약 접수 중...")
            : step < 4
              ? "다음"
              : consultRequired
                ? "상담 접수하기"
                : "예약 신청 및 선금 안내"}
        </button>
      </div>
      {step === 4 && !consultRequired && (
        <p className="mt-2 text-center text-xs text-[var(--ink-soft)]">
          신청 완료 후 같은 화면에서 예약 선금 입금 계좌를 바로 안내드립니다.
        </p>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
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
