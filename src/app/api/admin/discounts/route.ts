import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/session";
import { execute, queryRow, queryRows } from "@/database/connection";
import { normalizeCouponCode } from "@/lib/discounts";
import { z } from "zod";

/**
 * 할인 관리 (프로모션 + 쿠폰).
 *
 * 프로모션/쿠폰을 수정·중지·삭제해도 기존 예약의 금액 snapshot은 바뀌지 않는다.
 * (예약 snapshot은 reservations 테이블에 별도 보존된다)
 */

const ruleBase = {
  name: z.string().trim().min(1, "이름을 입력해주세요.").max(100),
  isActive: z.boolean().default(true),
  discountType: z.enum(["fixed", "percent"]).default("fixed"),
  discountValue: z.number().int().min(0).max(10_000_000),
  startsAt: z.string().max(40).nullish(),
  endsAt: z.string().max(40).nullish(),
  serviceType: z.string().max(30).nullish(),
  productKey: z.string().max(50).nullish(),
  minAmount: z.number().int().min(0).default(0),
  maxDiscountAmount: z.number().int().min(0).nullish(),
};

const promotionSchema = z.object({
  ...ruleBase,
  description: z.string().max(300).nullish(),
  priority: z.number().int().min(0).max(1000).default(0),
});

const couponSchema = z.object({
  ...ruleBase,
  code: z.string().trim().min(1, "쿠폰 코드를 입력해주세요.").max(40),
  totalUsageLimit: z.number().int().min(1).nullish(),
  perPhoneLimit: z.number().int().min(1).nullish(),
});

export async function GET() {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const [promotions, coupons] = await Promise.all([
    queryRows("SELECT * FROM discount_promotions ORDER BY priority DESC, id DESC"),
    // 사용수를 함께 집계한다 (N+1 없이 한 번에)
    queryRows(`
      SELECT c.*, COALESCE(r.used, 0) AS used_count
        FROM coupons c
        LEFT JOIN (
          SELECT coupon_id, COUNT(*) AS used FROM coupon_redemptions GROUP BY coupon_id
        ) r ON r.coupon_id = c.id
       ORDER BY c.id DESC`),
  ]);
  return NextResponse.json({ promotions, coupons });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const body = await req.json().catch(() => null);
  const kind = body?.kind;

  if (kind === "promotion") {
    const parsed = promotionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." },
        { status: 400 }
      );
    }
    const d = parsed.data;
    const params = [
      d.name, d.description ?? null, d.isActive ? 1 : 0, d.discountType, d.discountValue,
      d.startsAt || null, d.endsAt || null, d.serviceType || null, d.productKey || null,
      d.minAmount, d.maxDiscountAmount ?? null, d.priority,
    ];
    if (body.id) {
      await execute(
        `UPDATE discount_promotions SET
           name=?, description=?, is_active=?, discount_type=?, discount_value=?,
           starts_at=?, ends_at=?, service_type=?, product_key=?,
           min_amount=?, max_discount_amount=?, priority=?, updated_at=datetime('now')
         WHERE id=?`,
        [...params, body.id]
      );
    } else {
      await execute(
        `INSERT INTO discount_promotions
           (name, description, is_active, discount_type, discount_value,
            starts_at, ends_at, service_type, product_key, min_amount, max_discount_amount, priority)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        params
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (kind === "coupon") {
    const parsed = couponSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "입력값을 확인해주세요." },
        { status: 400 }
      );
    }
    const d = parsed.data;
    // 코드는 정규화(trim + 대문자)해서 저장·비교한다
    const code = normalizeCouponCode(d.code);

    const dup = await queryRow<{ id: number }>(
      "SELECT id FROM coupons WHERE code = ?", [code]
    );
    if (dup && dup.id !== body.id) {
      return NextResponse.json(
        { error: `이미 사용 중인 쿠폰 코드입니다: ${code}`, code: "COUPON_CODE_DUPLICATE" },
        { status: 409 }
      );
    }

    const params = [
      code, d.name, d.isActive ? 1 : 0, d.discountType, d.discountValue,
      d.startsAt || null, d.endsAt || null, d.serviceType || null, d.productKey || null,
      d.minAmount, d.maxDiscountAmount ?? null, d.totalUsageLimit ?? null, d.perPhoneLimit ?? null,
    ];
    if (body.id) {
      await execute(
        `UPDATE coupons SET
           code=?, name=?, is_active=?, discount_type=?, discount_value=?,
           starts_at=?, ends_at=?, service_type=?, product_key=?,
           min_amount=?, max_discount_amount=?, total_usage_limit=?, per_phone_limit=?,
           updated_at=datetime('now')
         WHERE id=?`,
        [...params, body.id]
      );
    } else {
      await execute(
        `INSERT INTO coupons
           (code, name, is_active, discount_type, discount_value, starts_at, ends_at,
            service_type, product_key, min_amount, max_discount_amount, total_usage_limit, per_phone_limit)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdminApiSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const id = Number(searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (kind === "promotion") {
    await execute("DELETE FROM discount_promotions WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  }
  if (kind === "coupon") {
    // 사용 이력이 있으면 삭제 대신 중지를 권장한다 (기존 예약 snapshot 보존)
    const used = await queryRow<{ c: number }>(
      "SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = ?", [id]
    );
    if (Number(used?.c ?? 0) > 0) {
      return NextResponse.json(
        { error: "사용 이력이 있는 쿠폰은 삭제할 수 없습니다. 중지로 처리해주세요.", code: "COUPON_IN_USE" },
        { status: 409 }
      );
    }
    await execute("DELETE FROM coupons WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
}
