import { calculateDiscounts } from "@/lib/discounts";
import { getServiceProductPrice } from "@/lib/pricing";

export interface OneRoomOffer {
  basePrice: number;
  openPrice: number;
  discountAmount: number;
  promotionName: string | null;
}

export async function getOneRoomOffer(): Promise<OneRoomOffer | null> {
  const product = await getServiceProductPrice("입주청소", "원룸");
  if (!product || !product.isActive || product.basePrice <= 0) return null;

  const discount = await calculateDiscounts({
    serviceType: "입주청소",
    productKey: "원룸",
    originalAmount: product.basePrice,
  });

  return {
    basePrice: product.basePrice,
    openPrice: discount.finalAmount,
    discountAmount: discount.automaticDiscountAmount,
    promotionName: discount.promotionName,
  };
}
