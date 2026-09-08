export async function requireAdminApiSession() {
  return { session: { name: '테스트관리자', adminId: null } };
}
