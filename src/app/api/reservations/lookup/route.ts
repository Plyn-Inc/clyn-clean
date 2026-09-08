import { NextRequest, NextResponse } from "next/server";
import { getReservationByCode, getPaymentByReservationId } from "@/lib/reservations";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const phone = searchParams.get("phone");

  if (!code || !phone) {
    return NextResponse.json({ error: "예약번호와 연락처를 입력해주세요." }, { status: 400 });
  }

  const reservation = await getReservationByCode(code);
  if (!reservation || reservation.customer_phone !== phone) {
    return NextResponse.json({ error: "일치하는 예약 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  const payment = await getPaymentByReservationId(reservation.id);
  return NextResponse.json({ reservation, payment });
}
