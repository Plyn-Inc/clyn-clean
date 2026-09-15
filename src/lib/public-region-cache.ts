import { unstable_cache } from "next/cache";
import {
  countAreas,
  listAvailableChildren,
  listAvailableSidos,
} from "@/database/repositories/region-repository";

export const PUBLIC_REGION_CACHE_TAG = "public-regions";

export const listCachedAvailableSidos = unstable_cache(
  async () => listAvailableSidos(),
  ["public-regions-sidos"],
  { revalidate: 300, tags: [PUBLIC_REGION_CACHE_TAG] }
);

export const listCachedAvailableChildren = unstable_cache(
  async (parentCode: string) => listAvailableChildren(parentCode),
  ["public-regions-children"],
  { revalidate: 300, tags: [PUBLIC_REGION_CACHE_TAG] }
);

export const countCachedAdministrativeAreas = unstable_cache(
  async () => countAreas(),
  ["public-regions-count"],
  { revalidate: 300, tags: [PUBLIC_REGION_CACHE_TAG] }
);
