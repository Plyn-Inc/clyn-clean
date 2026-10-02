import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { queryRows } from "@/database/connection";
import { DEFAULT_HOLIDAY_SURCHARGE } from "@/lib/settings";

interface OverviewRow {
  row_type: "rule" | "promotion" | "link" | "setting";
  a: string | null;
  b: string | null;
  c: string | null;
  d: string | null;
  e: string | null;
  f: string | null;
  g: string | null;
}

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const rows = await queryRows<OverviewRow>(`
    SELECT 'rule' AS row_type,
           CAST(id AS TEXT) AS a,
           service_type AS b,
           product_key AS c,
           note AS d,
           CAST(base_price AS TEXT) AS e,
           CAST(deposit_amount AS TEXT) AS f,
           CAST(is_active AS TEXT) AS g
      FROM price_rules
    UNION ALL
    SELECT 'promotion',
           CAST(id AS TEXT),
           name,
           discount_type,
           NULL,
           CAST(discount_value AS TEXT),
           CAST(max_discount_amount AS TEXT),
           CAST(is_active AS TEXT)
      FROM discount_promotions
    UNION ALL
    SELECT 'link',
           CAST(price_rule_id AS TEXT),
           CAST(promotion_id AS TEXT),
           NULL,
           NULL,
           CAST(sort_order AS TEXT),
           NULL,
           NULL
      FROM price_rule_discounts
    UNION ALL
    SELECT 'setting',
           key,
           value,
           NULL,
           NULL,
           NULL,
           NULL,
           NULL
      FROM settings
     WHERE key = 'holiday_surcharge'
  `);

  const rules: Array<{
    id: number;
    service_type: string;
    product_key: string | null;
    note: string | null;
    base_price: number;
    deposit_amount: number;
    is_active: number;
  }> = [];
  const promotions: Array<{
    id: number;
    name: string;
    is_active: number;
    discount_type: "fixed" | "percent";
    discount_value: number;
    max_discount_amount: number | null;
  }> = [];
  const links: Array<{ price_rule_id: number; promotion_id: number }> = [];
  let holidaySurcharge = DEFAULT_HOLIDAY_SURCHARGE;

  for (const row of rows) {
    if (row.row_type === "rule") {
      rules.push({
        id: Number(row.a),
        service_type: row.b ?? "",
        product_key: row.c,
        note: row.d,
        base_price: Number(row.e ?? 0),
        deposit_amount: Number(row.f ?? 0),
        is_active: Number(row.g ?? 0),
      });
    } else if (row.row_type === "promotion") {
      promotions.push({
        id: Number(row.a),
        name: row.b ?? "",
        discount_type: row.c === "percent" ? "percent" : "fixed",
        discount_value: Number(row.e ?? 0),
        max_discount_amount: row.f == null ? null : Number(row.f),
        is_active: Number(row.g ?? 0),
      });
    } else if (row.row_type === "link") {
      links.push({
        price_rule_id: Number(row.a),
        promotion_id: Number(row.b),
      });
    } else if (row.row_type === "setting" && row.a === "holiday_surcharge") {
      const parsed = Number(row.b);
      if (Number.isFinite(parsed) && parsed >= 0) holidaySurcharge = parsed;
    }
  }

  return NextResponse.json({
    rules,
    promotions,
    links,
    holidaySurcharge,
  });
}
