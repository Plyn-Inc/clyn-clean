"use client";

import { useRef, useState } from "react";
import StableReservationCalendar from "./StableReservationCalendar";
import BookingForm from "./BookingForm";
import type { SelectedSlot } from "./ReservationCalendar";
import { SERVICE_TYPES } from "@/lib/types";
import type { ServiceType } from "@/lib/types";

export interface BookingSectionProps {
  mode?: "default" | "one-room";
  layout?: "default" | "hero";
}

export default function BookingSection({ mode = "default", layout = "default" }: BookingSectionProps) {
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<ServiceType>(SERVICE_TYPES[0]);
  const bookingRef = useRef<HTMLDivElement | null>(null);
  const heroLayout = layout === "hero";
  const hasSelection = Boolean(selectedSlot || selectedDate);

  function handleSelectSlot(slot: SelectedSlot) {
    setSelectedSlot(slot);
    setSelectedDate(null);
    if (!heroLayout) bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    setSelectedSlot(null);
    if (!heroLayout) bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleServiceChange(nextService: ServiceType) {
    setActiveService(nextService);
    setSelectedSlot(null);
    setSelectedDate(null);
  }

  function handleSelectConsult(date: string) {
    const contactSection = document.getElementById("contact");
    contactSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    alert(`${date}는 상담이 필요한 날짜입니다. 문의하기를 통해 상담을 진행해주세요.`);
  }

  function resetHeroDate() {
    setSelectedSlot(null);
    setSelectedDate(null);
  }

  const calendar = (
    <div id="calendar" className="scroll-mt-24">
      <StableReservationCalendar
        onSelectSlot={handleSelectSlot}
        onSelectDate={handleSelectDate}
        onSelectConsultDate={handleSelectConsult}
        selectedSlot={selectedSlot}
        selectedDate={selectedDate}
        dateOnly={activeService === "사이청소"}
      />
    </div>
  );

  const booking = (
    <div id="booking" ref={bookingRef} className="scroll-mt-24">
      {heroLayout && hasSelection && (
        <button
          type="button"
          onClick={resetHeroDate}
          className="mb-3 min-h-[40px] rounded-full border border-[var(--line)] bg-white px-4 text-xs font-semibold text-[var(--navy)]"
        >
          ← 날짜 다시 선택
        </button>
      )}
      <BookingForm
        selectedSlot={selectedSlot}
        selectedDate={selectedDate}
        onServiceChange={mode === "one-room" ? undefined : handleServiceChange}
        mode={mode}
      />
    </div>
  );

  if (heroLayout) {
    return (
      <div className="grid gap-3 [&_#calendar>div]:p-3 [&_#calendar>div>div:first-child]:mb-2 [&_#calendar_button]:min-h-[30px] [&_#calendar_button]:py-0.5 [&_#booking>div]:p-4 [&_#booking_ol]:mb-4">
        {heroLayout && !hasSelection ? calendar : null}
        {heroLayout && hasSelection ? booking : null}
      </div>
    );
  }

  return <div className="grid gap-6 lg:grid-cols-[420px_1fr]">{calendar}{booking}</div>;
}
