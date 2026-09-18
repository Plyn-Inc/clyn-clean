"use client";

import { useEffect } from "react";
import { captureMarketingAttribution, sendMarketingEvent } from "@/lib/marketing-attribution";

export default function MarketingAttributionCapture({ trackLanding = true }: { trackLanding?: boolean }) {
  useEffect(() => {
    captureMarketingAttribution();
    if (!trackLanding) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    const sendLanding = () => void sendMarketingEvent("landing_view");

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(sendLanding, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(sendLanding, 1000);
    }

    return () => {
      if (idleId !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [trackLanding]);
  return null;
}
