"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
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
import type { OccupancyStatus, ServiceType } from "@/lib/types";
import type { SelectedSlot } from "./ReservationCalendar";
import AgreementSection, { type AgreementState } from "./AgreementSection";
import RegionSelect, { EMPTY_REGION, type RegionValue } from "./RegionSelect";
import DepositAccountPanel, { type DepositAccountInfo } from "./DepositAccountPanel";
import { bookingMaxDate, bookingMinDate, isWithinBookingWindow, outOfWindowMessage } from "@/lib/booking-window";
import { callApi } from "@/lib/error-messages";
import { formatPhoneInput, isValidKoreanPhone } from "@/lib/utils";
import { getMarketingAttribution, sendMarketingEvent } from "@/lib/marketing-attribution";

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

interface PriceCatalogItem {
  serviceType: string;
  productKey: string;
  basePrice: number;
  depositAmount: number;
}

function createHalfHourOptions() {
  return Array.from({ length: 48 }, (_, index) => {
    const hour = Math.floor(index / 2);
    const minute = index % 2 === 0 ? "00" : "30";
    const value = `${String(hour).padStart(2, "0")}:${minute}`;
    const period = hour < 12 ? "오전" : "오후";
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return { value, label: `${period} ${displayHour}:${minute}` };
  });
}

const TIME_OPTIONS = createHalfHourOptions();
const QUOTE_MAX_AUTO_RETRIES = 2;
const QUOTE_RETRY_DELAY_MS = 900;
const QUOTE_RECOVERY_RETRY_DELAY_MS = 5000;

type Step = 1 | 2 | 3 | 4;
type BookingTimeSlot = "" | "morning" | "afternoon" | "all_day";
type Result =
  | { kind: "deposit"; info: DepositAccountInfo }
  | { kind: "consultation"; code: string; notice: string };

const STEP_LABELS = ["지역·서비스", "날짜", "고객정보", "확인·동의"];

interface BookingFormProps {
  selectedSlot: SelectedSlot | null;
  selectedDate?: string | null;
  onServiceChange?: (serviceType: ServiceType) => void;
  mode?: "default" | "one-room";
}

export default function BookingForm({ selectedSlot, selectedDate, onServiceChange, mode = "default" }: BookingFormProps) {
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // 1단계 — 지역 + 서비스
  const [serviceType, setServiceType] = useState<ServiceType>(mode === "one-room" ? "입주청소" : SERVICE_TYPES[0]);
  const [houseTypeKey, setHouseTypeKey] = useState(mode === "one-room" ? "원룸" : "");
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
  const today = bookingMinDate();
  const maxDate = bookingMaxDate();

  // 1단계 — 지역
  const [region, setRegion] = useState<RegionValue>(EMPTY_REGION);
  const [regionMasterImported, setRegionMasterImported] = useState<boolean | null>(null);

  // 3단계 — 고객정보 + 기존 현장정보 통합
  const [occupancyStatus, setOccupancyStatus] = useState<OccupancyStatus>("before_move_in");
  const [extraNotes, setExtraNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [addressEditing, setAddressEditing] = useState(false);

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
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  const successfulQuoteKeyRef = useRef<string | null>(null);
  // 쿠폰 — 적용/해제 시 /api/quote를 다시 호출해 새 quoteToken을 받는다.
  // 브라우저에서 금액이나 토큰 payload를 직접 수정하지 않는다.
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [discount, setDiscount] = useState<{
    originalAmount: number;
    automaticDiscountAmount: number;
    promotionName: string | null;
    couponDiscountAmount: number;
    couponCode: string | null;
    finalAmount: number;
    depositAmount: number;
    balanceAmount: number;
  } | null>(null);
  const [priceCatalog, setPriceCatalog] = useState<PriceCatalogItem[]>([]);
  const [priceCatalogLoading, setPriceCatalogLoading] = useState(true);
  const quoteStartedTrackedRef = useRef(false);

  const isOneRoomMode = mode === "one-room";
  const resolvedKey = isApartment
    ? apartmentSize === 40 ? "40평" : `${apartmentSize}평`
    : houseTypeKey;
  const entryRoute = selectedSlot || selectedDate ? "calendar" : "direct";
  const is40Plus = resolvedKey === "40평";
  const regionConsultRequired = region.serviceAvailable === false;
  const showRegionConsultNotice = region.serviceAvailable === false;
  const regionReadyForPricing = regionMasterImported === true && Boolean(region.sidoCode) && Boolean(region.sigunguCode || region.dongCode) && region.serviceAvailable !== false;
  const productKeyForPricing = serviceType === "집정리" ? jipjeongriPackage : resolvedKey;
  const catalogItem = priceCatalog.find((item) => item.serviceType === serviceType && item.productKey === productKeyForPricing);
  const baseCatalogQuote: Quote | null = catalogItem ? {
    basePrice: catalogItem.basePrice,
    estimatedTotal: catalogItem.basePrice,
    depositAmount: catalogItem.depositAmount,
    estimatedBalance: Math.max(catalogItem.basePrice - catalogItem.depositAmount, 0),
    priceConfirmed: resolvedKey !== "40평",
    notice: VAT_NOTICE,
    consultRequired: resolvedKey === "40평",
    consultNotice: resolvedKey === "40평" ? "40평 이상은 상담 후 최종 견적을 안내드립니다." : null,
    isStartingPrice: resolvedKey === "40평",
    displayPriceLabel: `${catalogItem.basePrice.toLocaleString("ko-KR")}원${resolvedKey === "40평" ? "부터" : ""}`,
    optionBreakdown: [],
  } : null;
  const displayQuote = desiredDate ? (quote ?? baseCatalogQuote) : baseCatalogQuote;
  const consultRequired = quote?.consultRequired === true || baseCatalogQuote?.consultRequired === true || regionConsultRequired;
  const quoteRequestKey = JSON.stringify({
    serviceType,
    resolvedKey,
    jipjeongriPackage,
    actualPyeong,
    entryRoute,
    desiredDate,
    timeSlot: serviceType === "사이청소" ? "all_day" : timeSlot,
    appliedCoupon,
    sidoCode: region.sidoCode,
    sigunguCode: region.sigunguCode,
    dongCode: region.dongCode,
    moveOutTime: serviceType === "사이청소" ? moveOutTime : "",
    moveInTime: serviceType === "사이청소" ? moveInTime : "",
  });

  useEffect(() => {
    if (mode !== "one-room") return;
    void Promise.resolve().then(() => {
      setServiceType("입주청소");
      setHouseTypeKey("원룸");
      setIsApartment(false);
      onServiceChange?.("입주청소");
    });
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // 캘린더 선택을 폼 상태에 반영한다.
    // effect 내 동기 setState 경고를 피하기 위해 microtask로 넘긴다.
    void Promise.resolve().then(() => {
    if (serviceType === "사이청소") {
      if (!selectedDate) return;
      setDesiredDate(selectedDate);
      setTimeSlot("all_day");
      return;
    }
    if (!selectedSlot) return;
    setDesiredDate(selectedSlot.date);
    setTimeSlot(selectedSlot.timeSlot);
    });
  }, [selectedSlot, selectedDate, serviceType]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pricing")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("pricing fetch failed")))
      .then((d) => {
        if (!cancelled) setPriceCatalog(Array.isArray(d.items) ? d.items : []);
      })
      .catch(() => {
        if (!cancelled) setPriceCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setPriceCatalogLoading(false);
      });
    return () => { cancelled = true; };
  }, []);


  // 최신 견적 요청만 화면 상태를 갱신한다.
  // 이름/연락처 입력은 견적 조건이 아니다. 가격 조건이 바뀔 때만 새 토큰으로 교체한다.
  useEffect(() => {
    const hasProduct = serviceType === "집정리" || !!resolvedKey;
    if (!regionReadyForPricing || !hasProduct || !desiredDate) {
      void Promise.resolve().then(() => {
        setQuote(null);
        setQuoteToken(null);
        setDiscount(null);
        successfulQuoteKeyRef.current = null;
        setQuoteError(false);
        setQuoteLoading(false);
      });
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    // 다른 가격 조건으로 이동한 경우에만 이전 견적/토큰을 폐기한다.
    if (successfulQuoteKeyRef.current !== quoteRequestKey) {
      setQuote(null);
      setQuoteToken(null);
      setDiscount(null);
    }

    async function loadQuote(attempt: number) {
      if (cancelled) return;
      controller?.abort();
      controller = new AbortController();
      setQuoteError(false);
      setQuoteLoading(true);
      if (!quoteStartedTrackedRef.current) {
        quoteStartedTrackedRef.current = true;
        void sendMarketingEvent("quote_started");
      }

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
            areaSidoCode: region.sidoCode || undefined,
            areaSigunguCode: region.sigunguCode || undefined,
            areaDongCode: region.dongCode || undefined,
            moveOutTime: serviceType === "사이청소" ? moveOutTime || undefined : undefined,
            moveInTime: serviceType === "사이청소" ? moveInTime || undefined : undefined,
            couponCode: appliedCoupon || undefined,
            customerPhone: customerPhone || undefined,
          }),
        });
        const data = await res.json();
        if (cancelled || controller.signal.aborted) return;

        if (!res.ok) {
          if (typeof data?.code === "string" && data.code.startsWith("COUPON_")) {
            setCouponError(data.error ?? "쿠폰을 사용할 수 없습니다.");
            setAppliedCoupon(null);
            setQuoteLoading(false);
            return;
          }

          if (res.status >= 500) {
            if (attempt < QUOTE_MAX_AUTO_RETRIES) {
              retryTimer = setTimeout(() => void loadQuote(attempt + 1), QUOTE_RETRY_DELAY_MS * (attempt + 1));
              return;
            }
            setQuoteError(true);
            setQuoteLoading(false);
            retryTimer = setTimeout(() => void loadQuote(0), QUOTE_RECOVERY_RETRY_DELAY_MS);
            return;
          }

          setQuote(null);
          setQuoteToken(null);
          setDiscount(null);
          successfulQuoteKeyRef.current = null;
          setQuoteError(true);
          setQuoteLoading(false);
          return;
        }

        const nextToken = typeof data.quoteToken === "string" ? data.quoteToken : null;
        setCouponError(null);
        setQuote(data.quote ?? null);
        setQuoteToken(nextToken);
        setDiscount(data.discount ?? null);
        setQuoteError(!data.quote || !nextToken);
        setQuoteLoading(false);
        successfulQuoteKeyRef.current = nextToken ? quoteRequestKey : null;
      } catch {
        if (cancelled || controller.signal.aborted) return;
        if (attempt < QUOTE_MAX_AUTO_RETRIES) {
          retryTimer = setTimeout(() => void loadQuote(attempt + 1), QUOTE_RETRY_DELAY_MS * (attempt + 1));
          return;
        }
        setQuoteError(true);
        setQuoteLoading(false);
        retryTimer = setTimeout(() => void loadQuote(0), QUOTE_RECOVERY_RETRY_DELAY_MS);
      }
    }

    void loadQuote(0);
    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [regionReadyForPricing, serviceType, resolvedKey, jipjeongriPackage, actualPyeong, entryRoute, desiredDate, timeSlot, appliedCoupon, region.sidoCode, region.sigunguCode, region.dongCode, moveOutTime, moveInTime, quoteRequestKey]);

  function toggle(list: string[], v: string) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function selectService(nextService: ServiceType) {
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
      if (regionMasterImported === null) return "지역 정보를 확인 중입니다. 잠시만 기다려주세요.";
      if (regionMasterImported === false) {
        return "공식 행정구역 목록을 준비 중입니다. 관리자에서 행정구역 동기화를 완료해주세요.";
      }
      if (!region.sidoCode) return "시/도를 선택해주세요.";
      if (!region.sigunguCode && !region.dongCode) return "지역을 선택해주세요.";
      if (!region.dongCode) return "읍/면/동을 선택해주세요.";
      if (!address.trim()) return "상세 주소를 입력해주세요.";
      if (serviceType !== "집정리") {
        if (!resolvedKey) return "주택유형을 선택해주세요.";
        if (is40Plus && !actualPyeong) return "공급면적을 입력해주세요.";
      }
      if (!regionConsultRequired) {
        if (priceCatalogLoading) return "가격 정보를 준비 중입니다. 잠시만 기다려주세요.";
        if (!baseCatalogQuote) return "가격 정보를 확인할 수 없습니다. 다른 상품을 선택해주세요.";
      }
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
      } else if (timeSlot !== "morning" && timeSlot !== "afternoon") {
        return "오전 또는 오후를 선택해주세요.";
      }

      if (!regionConsultRequired && !quoteToken) {
        return quoteError
          ? "견적 연결을 자동 복구 중입니다. 잠시 후 다시 시도해주세요."
          : "최종 견적을 확인 중입니다. 잠시만 기다려주세요.";
      }
      return null;
    }

    if (s === 3) {
      if (!customerName.trim()) return "예약자명을 입력해주세요.";
      if (!customerPhone.trim()) return "연락처를 입력해주세요.";
      if (!isValidKoreanPhone(customerPhone)) return "연락처 형식을 확인해주세요.";
      if (extraNotes.length > 1000) return "기타 요청사항은 1000자 이내로 입력해주세요.";
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
      if (step === 1) void sendMarketingEvent("booking_started");
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
        address: address.trim(),
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
    const clientQuote = displayQuote;
    if (!quoteToken) {
      setError(quoteError ? "견적 연결을 자동 복구 중입니다. 잠시 후 다시 시도해주세요." : "최종 견적을 확인 중입니다. 잠시만 기다려주세요.");
      return;
    }
    if (!clientQuote || clientQuote.priceConfirmed !== true) {
      setError("견적금액을 확인할 수 없습니다. 표시된 견적을 확인해주세요.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const reservationTimeSlot: BookingTimeSlot = serviceType === "사이청소" ? "all_day" : timeSlot;
    const outcome = await callApi<{
      reservation: { reservation_code: string };
      depositInfo: DepositAccountInfo;
    }>("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName,
        customerPhone,
        serviceType,
        region: `${region.sidoName} ${region.sigunguName}`.trim(),
        address: address.trim(),
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
        extraNotes: extraNotes.trim() || undefined,
        depositorName: customerName,
        privacyAgreed,
        corePrinciplesAgreed: agreement.corePrinciplesAgreed,
        serviceTermsAgreed: agreement.serviceTermsAgreed,
        additionalChargeAgreed: agreement.additionalChargeAgreed,
        marketingAttribution: getMarketingAttribution() ?? undefined,
        // 금액이 아니라 서버 서명 토큰을 보낸다 (브라우저 조작 차단)
        quoteToken,
      }),
    });

    if (outcome.kind !== "success") {
      setError(outcome.message);
      setSubmitting(false);
      return;
    }

    setResult({ kind: "deposit", info: outcome.data.depositInfo });
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

      {consultRequired && (quote?.consultNotice || showRegionConsultNotice) && (
        <div className="mb-5 rounded-xl bg-[#FBE9D3] p-4 text-sm leading-relaxed text-[var(--amber)]">
          {showRegionConsultNotice
            ? "입력하신 지역은 서비스 가능 여부 확인이 필요해 상담 접수로 진행됩니다."
            : quote?.consultNotice}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <div>
            <RegionSelect
              value={region}
              onChange={setRegion}
              onImportedChange={setRegionMasterImported}
            />
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-white p-4">
            <p className="text-xs font-semibold text-[var(--ink-soft)]">선택한 지역</p>
            <p className="mt-1 text-sm font-medium text-[var(--ink)]">
              {[region.sidoName, region.sigunguName, region.dongName].filter(Boolean).join(" > ") || "지역을 먼저 선택해주세요."}
            </p>
            <div className="mt-3">
              <Field label="상세 주소" required value={address} onChange={setAddress} placeholder="도로명 또는 지번 상세주소" />
            </div>
          </div>
          {isOneRoomMode ? (
            <div className="rounded-2xl border border-[var(--mint)] bg-[var(--mint-soft)] p-5">
              <p className="text-xs font-semibold text-[var(--mint)]">광고 전용 상품</p>
              <p className="mt-1 font-display text-lg font-bold text-[var(--navy)]">일반 단층 원룸 입주·퇴실청소</p>
              <p className="mt-2 text-xs leading-relaxed text-[var(--ink-soft)]">
                1.5룸·복층·투룸 이상은 이 온라인 원룸 상품 대상이 아닙니다. 해당 구조는 카카오톡 상담으로 문의해주세요.
              </p>
            </div>
          ) : (
            <>
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

            </>
          )}

          {regionReadyForPricing && (resolvedKey || serviceType === "집정리") && (
            <div className="rounded-2xl border-2 border-[var(--mint)] bg-[var(--mint-soft)] p-5">
              {priceCatalogLoading ? (
                <p className="text-sm text-[var(--ink-soft)]">가격 정보를 준비 중...</p>
              ) : displayQuote ? (
                <>
                  <p className="text-xs font-semibold text-[var(--mint)]">
                    {serviceLabel(serviceType)} · {resolvedKey === "40평" ? "40평 이상" : resolvedKey || "집정리"}
                  </p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-[var(--ink)]">{displayQuote.displayPriceLabel}</p>
                  <p className="mt-2 text-xs text-[var(--ink-soft)]">{VAT_NOTICE}</p>
                  {displayQuote.consultRequired && displayQuote.consultNotice ? (
                    <p className="mt-2 text-xs leading-relaxed text-[var(--amber)]">{displayQuote.consultNotice}</p>
                  ) : (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">날짜를 선택하면 최종 예약금액이 확정됩니다.</p>
                  )}

                  {/* 할인 breakdown — 서버 snapshot만 표시한다 */}
                  <DiscountBreakdown discount={discount} />

                  {/* 쿠폰 입력 */}
                  {!displayQuote.consultRequired && (
                    <CouponBox
                      value={couponInput}
                      onChange={setCouponInput}
                      applied={appliedCoupon}
                      error={couponError}
                      onApply={() => {
                        const code = couponInput.trim();
                        if (!code) return;
                        setCouponError(null);
                        setAppliedCoupon(code);
                      }}
                      onClear={() => {
                        setAppliedCoupon(null);
                        setCouponInput("");
                        setCouponError(null);
                      }}
                    />
                  )}
                </>
              ) : quoteError ? (
                <p className="text-sm text-[var(--ink-soft)]">견적 연결을 자동 복구 중입니다. 잠시 후 다시 확인해주세요.</p>
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
                  <select value={moveOutTime} onChange={(e) => setMoveOutTime(e.target.value)}
                    className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none">
                    <option value="">시간 선택</option>
                    {TIME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold">새 입주 예정시간 <span className="text-xs text-[var(--rose)]">*필수</span></label>
                  <select value={moveInTime} onChange={(e) => setMoveInTime(e.target.value)}
                    className="w-full rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none">
                    <option value="">시간 선택</option>
                    {TIME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
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

          {desiredDate && quoteLoading && regionReadyForPricing && (
            <div className="rounded-2xl border border-[var(--line)] bg-white p-5 text-sm text-[var(--ink-soft)]">최종 예약금액 계산 중...</div>
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
          <Field
            label="연락처"
            required
            value={customerPhone}
            onChange={(v) => setCustomerPhone(formatPhoneInput(v))}
            placeholder="010-0000-0000"
            inputMode="tel"
          />
          <div className="md:col-span-2 rounded-xl border border-[var(--line)] bg-[var(--sand-deep)] p-4">
            <p className="text-xs font-semibold text-[var(--ink-soft)]">작업 장소</p>
            <p className="mt-1 text-sm font-medium text-[var(--ink)]">
              {[region.sidoName, region.sigunguName, region.dongName].filter(Boolean).join(" ")} {address.trim()}
            </p>
          </div>

          {serviceType !== "사이청소" && serviceType !== "집정리" && (
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-semibold">입주 상태</label>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(OCCUPANCY_STATUS_LABEL) as [OccupancyStatus, string][])
                  .filter(([k]) => !isOneRoomMode || k === "before_move_in" || k === "after_move_out")
                  .map(([k, v]) => (
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
            <label className="mb-1.5 block text-sm font-semibold">기타 요청사항 <span className="font-normal text-[var(--ink-soft)]">(선택)</span></label>
            <textarea
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="예: 반려동물이 있었음, 곰팡이·스티커 자국, 오염이 심한 공간, 특별히 확인할 부분 등"
              className="w-full rounded-lg border border-[var(--line)] px-3.5 py-2.5 text-sm focus:border-[var(--mint)] focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
              <span>필요한 내용만 적어주세요. 최대 1000자까지 입력할 수 있습니다.</span>
              <span className="shrink-0">{extraNotes.length} / 1000자</span>
            </div>
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
              <p className="text-sm text-[var(--ink-soft)]">견적 연결을 자동 복구 중입니다. 잠시 후 다시 확인해주세요.</p>
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
            <SummaryRow
              label="작업 장소"
              value={`${[region.sidoName, region.sigunguName, region.dongName].filter(Boolean).join(" ")} ${address.trim()}`.trim()}
            />
            <div className="pt-2">
              {addressEditing ? (
                <div className="rounded-xl bg-[var(--sand-deep)] p-3">
                  <label className="mb-1.5 block text-xs font-semibold text-[var(--ink-soft)]">상세 주소</label>
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="도로명 또는 지번 상세주소"
                      className="min-h-[42px] flex-1 rounded-lg border border-[var(--line)] bg-white px-3 text-sm focus:border-[var(--mint)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!address.trim()) {
                          setError("상세 주소를 입력해주세요.");
                          return;
                        }
                        setError(null);
                        setAddressEditing(false);
                      }}
                      className="min-h-[42px] rounded-lg bg-[var(--navy)] px-4 text-xs font-semibold text-white"
                    >
                      수정 완료
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => { setError(null); setAddressEditing(true); }}
                    className="min-h-[40px] rounded-full border border-[var(--line)] px-4 text-xs font-semibold text-[var(--navy)]"
                  >
                    주소 수정
                  </button>
                </div>
              )}
            </div>
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

function Field({ label, value, onChange, placeholder, type = "text", required, inputMode }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold">
        {label} {required && <span className="text-xs text-[var(--rose)]">*필수</span>}
      </label>
      <input type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
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

/**
 * 할인 breakdown.
 *
 * 서버가 계산해 내려준 snapshot만 표시한다. 브라우저에서 금액을 계산하지 않는다.
 * 할인이 없는 항목은 -0원으로 표시하지 않는다.
 */
function DiscountBreakdown({
  discount,
}: {
  discount: {
    originalAmount: number;
    automaticDiscountAmount: number;
    promotionName: string | null;
    couponDiscountAmount: number;
    couponCode: string | null;
    finalAmount: number;
    depositAmount: number;
    balanceAmount: number;
  } | null;
}) {
  if (!discount) return null;
  const hasDiscount =
    discount.automaticDiscountAmount > 0 || discount.couponDiscountAmount > 0;
  const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

  return (
    <div className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-4 text-sm">
      {hasDiscount && (
        <>
          <Row label="기본 견적" value={won(discount.originalAmount)} />
          {discount.automaticDiscountAmount > 0 && (
            <Row
              label={discount.promotionName || "자동 할인"}
              value={`-${won(discount.automaticDiscountAmount)}`}
              tone="discount"
            />
          )}
          {discount.couponDiscountAmount > 0 && (
            <Row
              label={`${discount.couponCode ?? "쿠폰"} 쿠폰`}
              value={`-${won(discount.couponDiscountAmount)}`}
              tone="discount"
            />
          )}
          <div className="!mt-3 border-t border-dashed border-[var(--line)] pt-2.5" />
        </>
      )}
      <Row label="최종 견적" value={won(discount.finalAmount)} strong />
      <Row label="예약금" value={won(discount.depositAmount)} />
      <Row label="잔금" value={won(discount.balanceAmount)} />
    </div>
  );
}

function Row({
  label, value, strong, tone,
}: { label: string; value: string; strong?: boolean; tone?: "discount" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={`text-xs ${tone === "discount" ? "text-[var(--mint)]" : "text-[var(--ink-soft)]"}`}>
        {label}
      </span>
      <span
        className={
          strong
            ? "font-display text-base font-bold text-[var(--ink)]"
            : tone === "discount"
              ? "text-sm font-medium text-[var(--mint)]"
              : "text-sm text-[var(--ink)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

/**
 * 쿠폰 입력.
 *
 * 적용/해제는 상태만 바꾸고, 실제 금액은 /api/quote 재호출로 새 quoteToken과 함께 받는다.
 */
function CouponBox({
  value, onChange, applied, error, onApply, onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  applied: string | null;
  error: string | null;
  onApply: () => void;
  onClear: () => void;
}) {
  if (applied) {
    return (
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5">
        <span className="text-xs text-[var(--ink-soft)]">
          쿠폰 <b className="text-[var(--ink)]">{applied.toUpperCase()}</b> 적용됨
        </span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 text-xs font-medium text-[var(--ink-soft)] underline"
        >
          적용 해제
        </button>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="쿠폰 코드"
          className="min-h-[40px] flex-1 rounded-lg border border-[var(--line)] px-3 text-sm uppercase"
        />
        <button
          type="button"
          onClick={onApply}
          disabled={!value.trim()}
          className="min-h-[40px] shrink-0 rounded-lg border border-[var(--navy)] px-4 text-xs font-semibold text-[var(--navy)] disabled:opacity-40"
        >
          적용
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-[var(--rose)]">{error}</p>}
    </div>
  );
}
