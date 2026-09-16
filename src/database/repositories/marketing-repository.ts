import { execute } from "@/database/connection";
import type { MarketingAttribution, MarketingEventName } from "@/lib/marketing-attribution";

export async function saveReservationAttribution(
  reservationId: number,
  attribution: MarketingAttribution
): Promise<void> {
  await execute(
    `UPDATE reservations SET
      visitor_id = ?, first_source = ?, first_medium = ?, first_campaign = ?, first_keyword = ?,
      last_source = ?, last_medium = ?, last_campaign = ?, last_keyword = ?,
      landing_page = ?, first_visit_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      attribution.visitorId,
      attribution.firstSource,
      attribution.firstMedium,
      attribution.firstCampaign,
      attribution.firstKeyword,
      attribution.lastSource,
      attribution.lastMedium,
      attribution.lastCampaign,
      attribution.lastKeyword,
      attribution.landingPage,
      attribution.firstVisitAt,
      reservationId,
    ]
  );
}

export async function insertMarketingEvent(input: {
  eventName: MarketingEventName;
  attribution: MarketingAttribution;
  reservationId?: number | null;
}): Promise<void> {
  const a = input.attribution;
  await execute(
    `INSERT INTO marketing_events (
      reservation_id, visitor_id, event_name, source, medium, campaign, keyword, landing_page
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.reservationId ?? null,
      a.visitorId,
      input.eventName,
      a.lastSource,
      a.lastMedium,
      a.lastCampaign,
      a.lastKeyword,
      a.landingPage,
    ]
  );
}
