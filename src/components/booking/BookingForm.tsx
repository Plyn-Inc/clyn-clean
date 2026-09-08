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
} from "@/lib/types";
import type { OccupancyStatus } from "@/lib/types";
import type { SelectedSlot } from "./ReservationCalendar";

interface BankInfoMasked {
  bankName: string;
  accountNumberMasked: string;
  accountHolder: string;
  paymentDueHours: number;
}
interface BankInfoFull {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  paymentDueHours: number;
}
interface QuoteResult {
  basePrice: number;
  multiplier: number;
  priceAfterMultiplier: number;
  extraTotal: number;
  subtotal: number;
  instantDiscount: number;
  estimatedTotal: number;
  depositAmount: number;
  estimatedBalance: number;
  priceConfirmed: boolean;
  notice: string;
  optionBreakdown: { key: string; label: string; price: number; isConsult: boolean }[];
}
interface AvailableOption {
  option_key: string;
  option_label: string;
  price: number;
}

type Step = "quote" | "booking" | "done";

export default function BookingForm({ selectedSlot }: { selectedSlot: SelectedSlot | null }) {
  const [bank, setBank] = useState<BankInfoMasked | null>(null);
  const [today, setToday] = useState<string>("");
  const [step, setStep] = useState<Step>("quote");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultCode, setResultCode] = useState<string | null>(null);
  const [completedBankInfo, setCompletedBankInfo] = useState<BankInfoFull | null>(null);
  const [depositorNameResult, setDepositorNameResult] = useState<string>("");
  const [depositAmountResult, setDepositAmountResult] = useState<number>(0);

  // 견적 입력
  const [serviceType, setServiceType] = useState<string>(SERVICE_TYPES[0]);
  const [houseTypeKey, setHouseTypeKey] = useState<string>(""); // 원룸/원룸복층/투룸/쓰리룸 또는 아파트 선택
  const [isApartment, setIsApartment] = useState(false);
  const [apartmentSize, setApartmentSize] = useState<number>(24); // 아파트 평형
  const [actualPyeong, setActualPyeong] = useState<string>(""); // 40평 이상 실제 평수
  const [jipjeongriPackage, setJipjeongriPackage] = useState<string>("1p4h");
  const [jipjeongriSpaces, setJipjeongriSpaces] = useState<string[]>([]);
  const [extraOptions, setExtraOptions] = useState<string[]>([]);
  const [availableOptions, setAvailableOptions] = useState<AvailableOption[]>([]);

  // 반려동물 (구조화)
  const [hasPet, setHasPet] = useState<boolean>(false);
  const [petType, setPetType] = useState<string>("");      // dog/cat/other
  const [petCount, setPetCount] = useState<string>("1");
  const [petHairSoil, setPetHairSoil] = useState<string>(""); // 없음/보통/심함
  const [petSmell, setPetSmell] = useState<boolean>(false);
  const [petFeces, setPetFeces] = useState<boolean>(false);
  const [petNote, setPetNote] = useState<string>("");

  // 사이청소 시간
  const [moveOutTime, setMoveOutTime] = useState<string>("");
  const [moveInTime, setMoveInTime] = useState<string>("");

  // 자동견적 결과
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // 예약 입력
  const [desiredDate, setDesiredDate] = useState<string>(selectedSlot?.date || "");
  const [timeSlot, setTimeSlot] = useState<string>(selectedSlot?.timeSlot || "");
  const [region, setRegion] = useState("");
  const [address, setAddress] = useState("");
  const [occupancyStatus, setOccupancyStatus] = useState<OccupancyStatus>("before_move_in");
  const [extraNotes, setExtraNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [depositorName, setDepositorName] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);

  // selectedSlot 동기화
  const [prevSlot, setPrevSlot] = useState(selectedSlot);
  if (selectedSlot !== prevSlot) {
    setPrevSlot(selectedSlot);
    setDesiredDate(selectedSlot?.date || "");
    setTimeSlot(selectedSlot?.timeSlot || "");
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reservations")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setBank(data.bank);
        setToday(data.today || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quote")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const activeOptions = Array.isArray(data.options) ? data.options : [];
        setAvailableOptions(activeOptions);
        const activeKeys = new Set(activeOptions.map((o: AvailableOption) => o.option_key));
        setExtraOptions((prev) => prev.filter((key) => activeKeys.has(key)));
      })
      .catch(() => {
        if (!cancelled) setAvailableOptions([]);
      });
    return () => { cancelled = true; };
  }, []);

  // 실제 houseTypeKey 결정
  const resolvedKey = isApartment
    ? (apartmentSize === 40 ? "40평" : `${apartmentSize}평`)
    : houseTypeKey;

  // 견적 계산
  useEffect(() => {
    if (serviceType === "집정리") {
      let cancelled = false;
      fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceType, jipjeongriPackage }),
      }).then(r => r.json()).then(data => {
        if (!cancelled) { setQuote(data.quote || null); setQuoteLoading(false); }
      }).catch(() => { if (!cancelled) { setQuote(null); setQuoteLoading(false); } });
      return () => { cancelled = true; };
    }

    if (!resolvedKey) {
      return;
    }
    let cancelled = false;
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceType,
        houseTypeKey: resolvedKey,
        actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
        extraOptions,
        entryRoute: selectedSlot ? "calendar" : "direct",
        desiredDate: desiredDate || undefined,
        timeSlot: timeSlot || undefined,
      }),
    }).then(r => r.json()).then(data => {
      if (!cancelled) { setQuote(data.quote || null); setQuoteLoading(false); }
    }).catch(() => { if (!cancelled) { setQuote(null); setQuoteLoading(false); } });
    return () => { cancelled = true; };
  }, [serviceType, resolvedKey, jipjeongriPackage, extraOptions, selectedSlot, desiredDate, timeSlot, actualPyeong]);

  function toggleExtra(key: string) {
    setExtraOptions(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }
  function toggleSpace(s: string) {
    setJipjeongriSpaces(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  const entryRoute = selectedSlot ? "calendar" : "direct";
  const is40Plus = resolvedKey === "40평";

  function validateQuote(): string | null {
    if (serviceType !== "집정리" && !resolvedKey) return "주택유형을 선택해주세요.";
    if (is40Plus && !actualPyeong) return "실제 평수를 입력해주세요.";
    return null;
  }

  function handleQuoteNext() {
    const v = validateQuote();
    if (v) { setError(v); return; }
    if (!quote) { setError("견적을 계산 중입니다. 잠시 후 다시 시도해주세요."); return; }
    if (is40Plus && !actualPyeong) { setError("실제 평수를 입력해주세요."); return; }
    setError(null);
    setStep("booking");
  }

  function validateBooking(): string | null {
    if (!customerName.trim()) return "예약자명을 입력해주세요.";
    if (!customerPhone.trim()) return "연락처를 입력해주세요.";
    if (!region.trim()) return "지역을 입력해주세요.";
    if (!address.trim()) return "주소를 입력해주세요.";
    if (!desiredDate.trim()) return "희망 날짜를 선택해주세요.";
    if (today && desiredDate < today) return "과거 날짜는 선택할 수 없습니다.";
    if (!timeSlot) return "오전 또는 오후를 선택해주세요.";
    if (!depositorName.trim()) return "선입금 입금자명을 입력해주세요.";
    if (!privacyAgreed) return "개인정보 수집·이용에 동의해주세요.";
    if (serviceType === "사이청소") {
      if (!moveOutTime.trim()) return "기존 거주자 퇴거 완료 예정시간을 입력해주세요.";
      if (!moveInTime.trim()) return "신규 거주자 입주 예정시간을 입력해주세요.";
    }
    return null;
  }

  async function handleSubmit() {
    const v = validateBooking();
    if (v) { setError(v); return; }
    setError(null);
    setSubmitting(true);

    const extraMeta: Record<string, unknown> = {};
    if (hasPet) {
      extraMeta.pet = {
        type: petType || "미입력",
        count: petCount,
        hairSoil: petHairSoil || "미입력",
        smell: petSmell,
        feces: petFeces,
        note: petNote,
      };
    }
    if (serviceType === "집정리") {
      extraMeta.jipjeongriPackage = jipjeongriPackage;
      extraMeta.jipjeongriSpaces = jipjeongriSpaces;
    }

    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName, customerPhone,
          customerEmail: customerEmail || undefined,
          serviceType, region, address,
          houseTypeKey: serviceType !== "집정리" ? resolvedKey : undefined,
          actualPyeong: actualPyeong ? Number(actualPyeong) : undefined,
          jipjeongriPackage: serviceType === "집정리" ? jipjeongriPackage : undefined,
          occupancyStatus, desiredDate,
          moveOutTime: serviceType === "사이청소" ? moveOutTime : undefined,
          moveInTime: serviceType === "사이청소" ? moveInTime : undefined,
          timeSlot,
          entryRoute,
          extraOptions,
          extraNotes: extraNotes
            + (Object.keys(extraMeta).length ? "\n[내부메타] " + JSON.stringify(extraMeta) : ""),
          depositorName,
          privacyAgreed,
          clientEstimatedTotal: quote?.estimatedTotal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const codeMap: Record<string, string> = {
          DATE_FULLY_BOOKED: `${desiredDate} ${timeSlot === "morning" ? "오전" : "오후"} 시간대는 이미 예약이 마감됐습니다.`,
          DATE_OFF: `${desiredDate}는 휴무일입니다.`,
          SETTINGS_NOT_READY: "현재 예약 접수 설정이 준비 중입니다. 문의하기를 이용해주세요.",
        };
        setError(codeMap[data.code] || data.error || "예약 처리 중 오류가 발생했습니다.");
        setSubmitting(false);
        return;
      }
      setResultCode(data.reservation.reservation_code);
      setCompletedBankInfo(data.bankInfo || null);
      setDepositorNameResult(depositorName);
      setDepositAmountResult(data.payment?.amount || 0);
      setStep("done");
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 완료 화면 ──
  if (step === "done" && resultCode) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-7 text-center shadow-sm md:p-10">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--mint-soft)] text-2xl text-[var(--mint)]">✓</div>
        <h3 className="font-display text-xl font-bold">예약 신청이 완료됐습니다</h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">예약번호 <strong className="text-[var(--ink)]">{resultCode}</strong></p>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--ink-soft)]">
          아래 계좌로 선입금을 완료해주세요.<br />
          <strong>선입금 확인 후 담당자가 일정과 신청내용을 확인하여 예약을 확정해드립니다.</strong>
        </p>
        {completedBankInfo?.accountNumber && (
          <div className="mx-auto mt-6 max-w-sm rounded-xl bg-[var(--sand-deep)] p-5 text-left text-sm">
            <p className="mb-3 font-semibold">선입금 계좌 안내</p>
            <DRow label="은행" value={completedBankInfo.bankName} />
            <DRow label="계좌번호" value={completedBankInfo.accountNumber} highlight />
            <DRow label="예금주" value={completedBankInfo.accountHolder} />
            <DRow label="입금자명" value={depositorNameResult} />
            <DRow label="선입금 금액" value={depositAmountResult > 0 ? `${depositAmountResult.toLocaleString("ko-KR")}원` : "안내 예정"} bold />
            <DRow label="입금 기한" value={`접수 후 ${completedBankInfo.paymentDueHours}시간 이내`} />
          </div>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <a href={`/reservation?code=${resultCode}&phone=${encodeURIComponent(customerPhone)}`}
            className="rounded-full border border-[var(--mint)] px-5 py-2.5 text-sm font-medium text-[var(--mint)] hover:bg-[var(--mint-soft)]">
            예약 내역 확인
          </a>
        </div>
      </div>
    );
  }

  // ── 예약 입력 화면 ──
  if (step === "booking") {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-6 shadow-sm md:p-8">
        {/* 견적 요약 */}
        {quote && (
          <div className="mb-6 rounded-xl bg-[var(--mint-soft)] p-4">
            <p className="text-xs font-semibold text-[var(--mint)] mb-1">Clyn Clean 자동견적</p>
            <p className="text-sm font-bold text-[var(--ink)]">{serviceType} · {serviceType === "집정리" ? JIPJEONGRI_PACKAGES.find(p => p.key === jipjeongriPackage)?.label : resolvedKey}</p>
            {quote.priceConfirmed ? (
              <p className="text-lg font-bold mt-1">{quote.estimatedTotal.toLocaleString("ko-KR")}원</p>
            ) : (
              <p className="text-base font-bold mt-1 text-[var(--amber)]">기본 {quote.basePrice.toLocaleString("ko-KR")}원부터</p>
            )}
            {quote.optionBreakdown.filter(o => o.isConsult).length > 0 && (
              <p className="text-xs text-[var(--ink-soft)] mt-1">
                상담 후 확정: {quote.optionBreakdown.filter(o => o.isConsult).map(o => o.label).join(", ")}
              </p>
            )}
            <button onClick={() => setStep("quote")} className="mt-2 text-xs text-[var(--mint)] underline-offset-2 hover:underline">견적 수정하기</button>
          </div>
        )}

        {selectedSlot && (
          <div className="mb-5 flex items-center gap-2 rounded-xl bg-[var(--mint-soft)] px-4 py-3 text-sm font-medium text-[var(--mint)]">
            📅 {selectedSlot.date} {selectedSlot.timeSlot === "morning" ? "오전" : "오후"}
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="지역" value={region} onChange={setRegion} placeholder="예: 서울 강남구" />
          <Field label="상세 주소" value={address} onChange={setAddress} placeholder="동/호수 포함" />

          {serviceType !== "집정리" && (
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold">입주 상태</label>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(OCCUPANCY_STATUS_LABEL) as [OccupancyStatus, string][]).map(([k, v]) => (
                  <button key={k} type="button" onClick={() => setOccupancyStatus(k)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium ${occupancyStatus === k ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 사이청소 시간 */}
          {serviceType === "사이청소" && (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-semibold">기존 거주자 퇴거 완료 예정시간</label>
                <input type="datetime-local" value={moveOutTime} onChange={e => setMoveOutTime(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold">신규 거주자 입주 예정시간</label>
                <input type="datetime-local" value={moveInTime} onChange={e => setMoveInTime(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
              </div>
            </>
          )}

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold">
              희망 날짜 <span className="text-[var(--rose)] text-xs">*필수</span>
            </label>
            <input type="date" value={desiredDate} onChange={e => setDesiredDate(e.target.value)}
              min={today} disabled={!!selectedSlot}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none disabled:bg-[var(--sand-deep)]" />
          </div>

          {!selectedSlot && (
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-semibold">시간대</label>
              <div className="flex gap-3">
                {(["morning", "afternoon"] as const).map(s => (
                  <button key={s} type="button" onClick={() => setTimeSlot(s)}
                    className={`flex-1 rounded-lg border py-3 text-sm font-medium transition ${timeSlot === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    {s === "morning" ? "🌅 오전" : "🌆 오후"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="h-px md:col-span-2 bg-[var(--line)]" />

          <Field label="예약자명" value={customerName} onChange={setCustomerName} />
          <Field label="연락처" value={customerPhone} onChange={setCustomerPhone} placeholder="010-0000-0000" />
          <div className="md:col-span-2">
            <Field label="이메일 (선택)" value={customerEmail} onChange={setCustomerEmail} type="email" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold">기타 요청사항</label>
            <textarea value={extraNotes} onChange={e => setExtraNotes(e.target.value)} rows={3}
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
          </div>
        </div>

        {/* 선입금 입금자명 */}
        {bank?.bankName && (
          <div className="mt-5 rounded-2xl border border-[var(--line)] p-5">
            <p className="mb-2 text-sm font-semibold">선입금 계좌 안내</p>
            <p className="text-sm text-[var(--ink-soft)]">{bank.bankName} {bank.accountNumberMasked} (예금주: {bank.accountHolder})</p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">예약 신청 후 전체 계좌번호가 표시됩니다. 선입금 확인 후 담당자가 예약을 확정합니다.</p>
            <div className="mt-3">
              <label className="mb-1.5 block text-sm font-semibold">선입금 입금자명</label>
              <input value={depositorName} onChange={e => setDepositorName(e.target.value)}
                placeholder="예약자명과 동일하게"
                className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
            </div>
          </div>
        )}

        {/* 개인정보 동의 */}
        <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--sand-deep)] p-4">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={privacyAgreed} onChange={e => setPrivacyAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded" />
            <span className="text-sm">
              <strong>[필수]</strong> 개인정보 수집·이용에 동의합니다.{" "}
              <a href="/privacy" target="_blank" className="text-[var(--mint)] underline hover:opacity-80">개인정보처리방침</a>
            </span>
          </label>
        </div>

        {error && <div className="mt-4 rounded-lg bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">{error}</div>}

        <button onClick={handleSubmit} disabled={submitting || !privacyAgreed}
          className="mt-6 w-full rounded-full bg-[var(--navy)] py-3.5 text-center text-sm font-semibold text-white hover:bg-[var(--navy-deep)] disabled:opacity-50">
          {submitting ? "접수 중..." : "예약 신청"}
        </button>
        <p className="mt-2 text-center text-xs text-[var(--ink-soft)]">선입금 확인 후 담당자가 신청내용을 확인하여 예약을 확정해드립니다.</p>
      </div>
    );
  }

  // ── 견적 입력 화면 ──
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-white p-6 shadow-sm md:p-8">
      <p className="mb-5 text-sm font-semibold text-[var(--ink-soft)]">우리 집 예상 청소비용을 확인하세요</p>

      {/* 서비스 선택 */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-semibold">청소 종류</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SERVICE_TYPES.map(s => (
            <button key={s} type="button" onClick={() => { setServiceType(s); setHouseTypeKey(""); setIsApartment(false); setQuote(null); setQuoteLoading(s === "집정리"); }}
              className={`rounded-xl border py-3 text-sm font-medium transition ${serviceType === s ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink-soft)]"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 집정리 */}
      {serviceType === "집정리" ? (
        <>
          <div className="mb-5">
            <label className="mb-2 block text-sm font-semibold">인원 패키지 선택</label>
            <div className="grid gap-2 sm:grid-cols-3">
              {JIPJEONGRI_PACKAGES.map(p => (
                <button key={p.key} type="button" onClick={() => setJipjeongriPackage(p.key)}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium ${jipjeongriPackage === p.key ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">추가 1인 / 1시간 — 30,000원. 폐기물·폐기차 별도.</p>
          </div>
          <div className="mb-5">
            <label className="mb-2 block text-sm font-semibold">정리 공간 (선택)</label>
            <div className="flex flex-wrap gap-2">
              {JIPJEONGRI_SPACES.map(s => (
                <button key={s} type="button" onClick={() => toggleSpace(s)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium ${jipjeongriSpaces.includes(s) ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* 주택 유형 */}
          <div className="mb-5">
            <label className="mb-2 block text-sm font-semibold">주택 유형</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {HOUSE_TYPES_FIXED.map(t => (
                <button key={t} type="button" onClick={() => { setHouseTypeKey(t); setIsApartment(false); setQuoteLoading(true); setQuote(null); }}
                  className={`rounded-xl border py-3 text-sm font-medium ${!isApartment && houseTypeKey === t ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                  {t}
                </button>
              ))}
              <button type="button" onClick={() => { setIsApartment(true); setHouseTypeKey("아파트/주택"); setQuoteLoading(true); setQuote(null); }}
                className={`rounded-xl border py-3 text-sm font-medium col-span-2 sm:col-span-4 ${isApartment ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                아파트 / 주택
              </button>
            </div>
          </div>

          {/* 아파트 평형 */}
          {isApartment && (
            <div className="mb-5">
              <label className="mb-2 block text-sm font-semibold">평형 선택</label>
              <div className="grid grid-cols-4 gap-2">
                {HOUSE_SIZES_APARTMENT.map(sz => (
                  <button key={sz} type="button" onClick={() => { setApartmentSize(sz); setQuoteLoading(true); setQuote(null); }}
                    className={`rounded-xl border py-2.5 text-sm font-medium ${apartmentSize === sz ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    {HOUSE_SIZE_LABEL[sz]}
                  </button>
                ))}
              </div>
              {apartmentSize === 40 && (
                <div className="mt-3">
                  <label className="mb-1.5 block text-sm font-semibold">실제 평수 입력</label>
                  <input type="number" value={actualPyeong} onChange={e => setActualPyeong(e.target.value)}
                    placeholder="예: 52" min={40} max={300}
                    className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">40평 이상은 실제 평수와 구조 확인 후 최종 견적을 안내드립니다.</p>
                </div>
              )}
            </div>
          )}

          {/* 추가 옵션 */}
          {(houseTypeKey || isApartment) && (
            <div className="mb-5">
              <label className="mb-2 block text-sm font-semibold">추가 서비스 (선택)</label>
              <div className="flex flex-wrap gap-2">
                {availableOptions.map((opt) => (
                  <button key={opt.option_key} type="button" onClick={() => toggleExtra(opt.option_key)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${extraOptions.includes(opt.option_key) ? "border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    {opt.option_label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--ink-soft)]">일부 추가서비스는 제품·작업범위 확인 후 금액을 사전에 안내드립니다. 선택하면 예약 정보에 기록됩니다.</p>
            </div>
          )}
        </>
      )}

      {/* 반려동물 */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-semibold">반려동물</label>
        <div className="flex gap-3">
          {([false, true] as const).map(v => (
            <button key={String(v)} type="button" onClick={() => setHasPet(v)}
              className={`flex-1 rounded-lg border py-2.5 text-sm font-medium ${hasPet === v ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-[var(--line)] text-[var(--ink-soft)]"}`}>
              {v ? "있음" : "없음"}
            </button>
          ))}
        </div>
        {hasPet && (
          <div className="mt-3 space-y-3 rounded-xl border border-[var(--line)] p-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">종류</p>
              <div className="flex gap-2">
                {[["dog","반려견"],["cat","반려묘"],["other","기타"]].map(([v,l]) => (
                  <button key={v} type="button" onClick={() => setPetType(v)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${petType===v?"border-[var(--mint)] bg-[var(--mint-soft)] text-[var(--mint)]":"border-[var(--line)] text-[var(--ink-soft)]"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">마리 수</p>
                <select value={petCount} onChange={e=>setPetCount(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm focus:border-[var(--mint)] focus:outline-none">
                  {["1","2","3","4이상"].map(n=><option key={n} value={n}>{n}마리</option>)}
                </select>
              </div>
              <div className="flex-1">
                <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">털 오염 정도</p>
                <select value={petHairSoil} onChange={e=>setPetHairSoil(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm focus:border-[var(--mint)] focus:outline-none">
                  <option value="">선택</option>
                  <option value="없음">거의 없음</option>
                  <option value="보통">보통</option>
                  <option value="심함">심함</option>
                </select>
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={petSmell} onChange={e=>setPetSmell(e.target.checked)} className="h-4 w-4 rounded" />
                냄새 있음
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" checked={petFeces} onChange={e=>setPetFeces(e.target.checked)} className="h-4 w-4 rounded" />
                배변 오염 있음
              </label>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">추가 설명 (선택)</p>
              <textarea value={petNote} onChange={e=>setPetNote(e.target.value)} rows={2}
                placeholder="기타 오염 상태나 특이사항을 적어주세요."
                className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
            </div>
            <p className="text-xs text-[var(--ink-soft)]">반려동물 털·냄새·배변 오염 상태 확인 후 추가비용을 사전에 안내합니다.</p>
          </div>
        )}
      </div>

      {/* 견적 결과 */}
      {quoteLoading && <div className="mb-4 text-center text-sm text-[var(--ink-soft)]">견적 계산 중...</div>}
      {quote && !quoteLoading && (
        <div className="mb-5 rounded-2xl border-2 border-[var(--mint)] bg-[var(--mint-soft)] p-5">
          <p className="mb-2 text-sm font-bold text-[var(--mint)]">📊 Clyn Clean 자동견적</p>
          <div className="space-y-1.5 text-sm">
            {quote.priceConfirmed ? (
              <>
                <QRow label="기본 견적" value={`${quote.priceAfterMultiplier.toLocaleString("ko-KR")}원`} />
                {quote.optionBreakdown.filter(o => !o.isConsult && o.price > 0).map(o => (
                  <QRow key={o.key} label={o.label} value={`${o.price.toLocaleString("ko-KR")}원`} />
                ))}
                {quote.optionBreakdown.filter(o => o.isConsult).map(o => (
                  <QRow key={o.key} label={o.label} value="상담 후 확정" muted />
                ))}
                {/* 반려동물 있음인데 pet_extra를 선택하지 않은 경우 상담 항목으로 표시 */}
                {hasPet && !extraOptions.includes("pet_extra") && (
                  <QRow label="반려동물 오염" value="상태 확인 후 추가비용 사전 안내" muted />
                )}
                <div className="h-px bg-[var(--mint)]/30" />
                <QRow label="현재 자동견적" value={`${quote.estimatedTotal.toLocaleString("ko-KR")}원`} bold />
                {quote.depositAmount > 0 && <QRow label="선입금" value={`${quote.depositAmount.toLocaleString("ko-KR")}원`} />}
              </>
            ) : (
              <QRow label="기본 견적" value={`${quote.basePrice.toLocaleString("ko-KR")}원부터`} bold />
            )}
            <p className="mt-2 text-xs text-[var(--ink-soft)]">※ {quote.notice}</p>
          </div>
        </div>
      )}

      {error && <div className="mt-4 rounded-lg bg-[#FBEAE5] px-4 py-3 text-sm text-[var(--rose)]">{error}</div>}

      <button onClick={handleQuoteNext} disabled={!quote && serviceType !== "집정리"}
        className="mt-4 w-full rounded-full bg-[var(--navy)] py-3.5 text-center text-sm font-semibold text-white hover:bg-[var(--navy-deep)] disabled:opacity-50">
        {quote ? "이 견적으로 예약 신청하기" : "예약 신청하기"}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none" />
    </div>
  );
}
function DRow({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${bold ? "font-bold" : ""}`}>
      <span className="text-[var(--ink-soft)]">{label}</span>
      <span className={highlight ? "font-semibold text-[var(--navy)]" : ""}>{value}</span>
    </div>
  );
}
function QRow({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <p className={`flex justify-between ${bold ? "font-bold text-[var(--ink)]" : ""} ${muted ? "text-[var(--ink-soft)]" : "text-[var(--ink-soft)]"}`}>
      <span>{label}</span><span>{value}</span>
    </p>
  );
}
