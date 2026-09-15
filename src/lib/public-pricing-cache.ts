import { unstable_cache } from "next/cache";
import { listPriceRules } from "@/lib/pricing";

export const PUBLIC_PRICING_CACHE_TAG = "public-pricing";

export const listCachedPublicPriceRules = unstable_cache(
  async () => listPriceRules(),
  ["public-pricing-rules"],
  { revalidate: 300, tags: [PUBLIC_PRICING_CACHE_TAG] }
);
