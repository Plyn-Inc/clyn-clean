import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/session";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) {
    redirect("/admin/login");
  }

  // 명세 5번: 초기 관리자 계정은 최초 로그인 후 비밀번호 변경을 강제한다.
  if (session.mustChangePassword) {
    redirect("/admin/change-password");
  }

  return (
    <div className="flex min-h-[calc(100vh-200px)] flex-col md:flex-row">
      <AdminSidebar adminName={session.name} />
      <div className="flex-1 bg-[var(--sand)] px-5 py-8 md:px-10 md:py-10">{children}</div>
    </div>
  );
}
