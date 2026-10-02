import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApiSession } from "@/lib/session";
import { execute, queryRow, queryRows, withTransaction } from "@/database/connection";

const saveSchema = z.object({
  priceRuleId: z.number().int().positive(),
  promotionIds: z.array(z.number().int().positive()).max(100),
});

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const links = await queryRows<{ price_rule_id: number; promotion_id: number }>(
    `SELECT price_rule_id, promotion_id
       FROM price_rule_discounts
      ORDER BY price_rule_id, sort_order, promotion_id`
  );
  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." },
      { status: 400 }
    );
  }

  const { priceRuleId } = parsed.data;
  const promotionIds = Array.from(new Set(parsed.data.promotionIds));

  const priceRule = await queryRow<{ id: number }>(
    "SELECT id FROM price_rules WHERE id = ?",
    [priceRuleId]
  );
  if (!priceRule) {
    return NextResponse.json({ error: "가격 항목을 찾을 수 없습니다." }, { status: 404 });
  }

  if (promotionIds.length > 0) {
    const placeholders = promotionIds.map(() => "?").join(",");
    const found = await queryRows<{ id: number }>(
      `SELECT id FROM discount_promotions WHERE id IN (${placeholders})`,
      promotionIds
    );
    if (found.length !== promotionIds.length) {
      return NextResponse.json({ error: "존재하지 않는 할인 항목이 포함되어 있습니다." }, { status: 400 });
    }
  }

  await withTransaction(async () => {
    await execute("DELETE FROM price_rule_discounts WHERE price_rule_id = ?", [priceRuleId]);
    for (let index = 0; index < promotionIds.length; index += 1) {
      await execute(
        `INSERT INTO price_rule_discounts (price_rule_id, promotion_id, sort_order)
         VALUES (?, ?, ?)`,
        [priceRuleId, promotionIds[index], index]
      );
    }
  });

  return NextResponse.json({ ok: true });
}
