import { MyPageShell } from "@/components/my-page-shell";
import { SiteShell } from "@/components/site-shell";
import { DashboardAutoRefresh } from "@/features/personal/dashboard-auto-refresh";
import { DashboardContent } from "@/features/personal/dashboard-content";
import { LoginRequired } from "@/features/personal/login-required";
import { getViewerContext } from "@/lib/auth/viewer";
import { getDashboardData } from "@/lib/data";

export default async function MyDashboardPage() {
  const { viewer } = await getViewerContext();

  if (!viewer) {
    return (
      <SiteShell activePath="/me">
        <LoginRequired
          title="로그인이 필요합니다."
          description="My Page는 Supabase Auth 세션이 있는 사용자에게만 실제 계정 데이터를 표시합니다."
        />
      </SiteShell>
    );
  }

  const dashboard = await getDashboardData(viewer);

  return (
    <SiteShell activePath="/me" viewer={viewer}>
      <MyPageShell activeTab="dashboard" viewer={viewer}>
        <DashboardAutoRefresh intervalMs={30_000} />
        <DashboardContent viewer={viewer} dashboard={dashboard} />
      </MyPageShell>
    </SiteShell>
  );
}
