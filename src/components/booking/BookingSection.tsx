"use client";

import { useRef, useState } from "react";
import ReservationCalendar from "./ReservationCalendar";
import BookingForm from "./BookingForm";
import type { SelectedSlot } from "./ReservationCalendar";

export default function BookingSection() {
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const bookingRef = useRef<HTMLDivElement | null>(null);

  function handleSelectSlot(slot: SelectedSlot) {
    setSelectedSlot(slot);
    bookingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSelectConsult(date: string) {
    const contactSection = document.getElementById("contact");
    contactSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    alert(`${date}는 상담이 필요한 날짜입니다. 문의하기를 통해 상담을 진행해주세요.`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <div id="calendar" className="scroll-mt-24">
        <ReservationCalendar
          onSelectSlot={handleSelectSlot}
          onSelectConsultDate={handleSelectConsult}
        />
      </div>
      <div id="booking" ref={bookingRef} className="scroll-mt-24">
        <BookingForm selectedSlot={selectedSlot} />
      </div>
    </div>
  );
}
