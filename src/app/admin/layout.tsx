import type { Metadata } from "next";

export const metadata: Metadata = {
  // 관리자 영역 전체 noindex
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
