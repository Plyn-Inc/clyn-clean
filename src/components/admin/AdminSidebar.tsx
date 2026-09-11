"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { href: "/admin/dashboard", label: "대시보드" },
  { href: "/admin/reservations", label: "예약 관리" },
  { href: "/admin/consultations", label: "상담 접수" },
  { href: "/admin/calendar", label: "캘린더 관리" },
  { href: "/admin/special-days", label: "공휴일 관리" },
  { href: "/admin/pricing", label: "가격 설정" },
  { href: "/admin/settings", label: "요금/계좌 설정" },
  { href: "/admin/reviews", label: "후기 관리" },
  { href: "/admin/posts", label: "블로그 관리" },
];

export default function AdminSidebar({ adminName }: { adminName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <aside className="w-full shrink-0 border-b border-[var(--line)] bg-white md:w-60 md:border-b-0 md:border-r">
      <div className="px-5 py-5 md:px-6">
        <p className="font-display text-base font-bold">관리자 페이지</p>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">{adminName}님</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-3">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-[var(--navy)] text-white"
                  : "text-[var(--ink-soft)] hover:bg-[var(--sand-deep)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={handleLogout}
          className="mt-1 whitespace-nowrap rounded-lg px-3.5 py-2.5 text-left text-sm font-medium text-[var(--rose)] hover:bg-[#FBEAE5]"
        >
          로그아웃
        </button>
      </nav>
    </aside>
  );
}
