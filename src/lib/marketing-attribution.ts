export type MarketingEventName =
  | "landing_view"
  | "booking_started"
  | "quote_started"
  | "booking_completed"
  | "kakao_clicked";

export interface MarketingAttribution {
  visitorId: string;
  firstSource: string | null;
  firstMedium: string | null;
  firstCampaign: string | null;
  firstKeyword: string | null;
  lastSource: string | null;
  lastMedium: string | null;
  lastCampaign: string | null;
  lastKeyword: string | null;
  landingPage: string;
  firstVisitAt: string;
}

const STORAGE_KEY = "clyn_marketing_attribution_v1";

function safeText(value: string | null, max = 200): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function makeVisitorId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function currentTouch() {
  const params = new URLSearchParams(window.location.search);
  const explicitSource = safeText(params.get("utm_source") || params.get("source"));
  const referrerHost = (() => {
    try {
      return document.referrer ? new URL(document.referrer).hostname : null;
    } catch {
      return null;
    }
  })();

  return {
    source: explicitSource || (referrerHost ? "referral" : "direct"),
    medium: safeText(params.get("utm_medium") || params.get("medium")),
    campaign: safeText(params.get("utm_campaign") || params.get("campaign")),
    keyword: safeText(params.get("utm_term") || params.get("keyword")),
    landingPage: `${window.location.pathname}${window.location.search}`.slice(0, 500),
  };
}

export function getMarketingAttribution(): MarketingAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketingAttribution;
    return parsed?.visitorId && parsed?.landingPage ? parsed : null;
  } catch {
    return null;
  }
}

export function captureMarketingAttribution(): MarketingAttribution | null {
  if (typeof window === "undefined") return null;
  const touch = currentTouch();
  const existing = getMarketingAttribution();
  const now = new Date().toISOString();

  const next: MarketingAttribution = existing
    ? {
        ...existing,
        lastSource: touch.source,
        lastMedium: touch.medium,
        lastCampaign: touch.campaign,
        lastKeyword: touch.keyword,
      }
    : {
        visitorId: makeVisitorId(),
        firstSource: touch.source,
        firstMedium: touch.medium,
        firstCampaign: touch.campaign,
        firstKeyword: touch.keyword,
        lastSource: touch.source,
        lastMedium: touch.medium,
        lastCampaign: touch.campaign,
        lastKeyword: touch.keyword,
        landingPage: touch.landingPage,
        firstVisitAt: now,
      };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

export async function sendMarketingEvent(eventName: MarketingEventName): Promise<void> {
  if (typeof window === "undefined") return;
  const attribution = getMarketingAttribution() ?? captureMarketingAttribution();
  if (!attribution) return;
  try {
    await fetch("/api/marketing/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ eventName, attribution }),
    });
  } catch {
    // 마케팅 측정 실패가 고객 흐름을 막아서는 안 된다.
  }
}
