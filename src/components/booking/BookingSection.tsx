"use client";

import { useRef, useState } from "react";
import ReservationCalendar from "./ReservationCalendar";
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

  function handleSelectSlot(slot: SelectedSlot) {
    setSelectedSlot(slot);
    setSelectedDate(null);
    bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
    setSelectedSlot(null);
    bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const heroLayout = layout === "hero";

  return (
    <div className={heroLayout ? "grid gap-4" : "grid gap-6 lg:grid-cols-[420px_1fr]"}>
      <div id="calendar" className="scroll-mt-24">
        <ReservationCalendar
          onSelectSlot={handleSelectSlot}
          onSelectDate={handleSelectDate}
          onSelectConsultDate={handleSelectConsult}
          selectedSlot={selectedSlot}
          selectedDate={selectedDate}
          dateOnly={activeService === "사이청소"}
        />
      </div>
      <div id="booking" ref={bookingRef} className="scroll-mt-24">
        <BookingForm
          selectedSlot={selectedSlot}
          selectedDate={selectedDate}
          onServiceChange={handleServiceChange}
          mode={mode}
        />
      </div>
    </div>
  );
}
