export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import ContactSection from "@/components/ContactSection";
import { getCompanySettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "문의하기",
  description: "예약 전 상담이 필요하다면 전화, 문자, 카카오톡으로 문의해주세요.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const company = await getCompanySettings();
  return <ContactSection company={company} />;
}
