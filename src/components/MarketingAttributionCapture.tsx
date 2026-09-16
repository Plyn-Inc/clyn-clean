"use client";

import { useEffect } from "react";
import { captureMarketingAttribution, sendMarketingEvent } from "@/lib/marketing-attribution";

export default function MarketingAttributionCapture({ trackLanding = true }: { trackLanding?: boolean }) {
  useEffect(() => {
    captureMarketingAttribution();
    if (trackLanding) void sendMarketingEvent("landing_view");
  }, [trackLanding]);
  return null;
}
