import { MyPageShell } from "@/components/my-page-shell";
import { SiteShell } from "@/components/site-shell";
import { DashboardAutoRefresh } from "@/features/personal/dashboard-auto-refresh";
import { InsightsContent } from "@/features/personal/insights-content";
import { LoginRequired } from "@/features/personal/login-required";
import { getViewerContext } from "@/lib/auth/viewer";
import { getInsights } from "@/lib/data";

export default async function MyInsightsPage() {
  const { viewer } = await getViewerContext();

  if (!viewer) {
    return (
      <SiteShell activePath="/me">
        <LoginRequired
          title="로그인이 필요합니다."
          description="인사이트는 Supabase Auth 세션이 있는 사용자에게만 실제 계정 데이터를 표시합니다."
        />
      </SiteShell>
    );
  }

  const insights = await getInsights(viewer);

  return (
    <SiteShell activePath="/me" viewer={viewer}>
      <MyPageShell activeTab="insights" viewer={viewer}>
        <DashboardAutoRefresh intervalMs={60_000} />
        <InsightsContent viewer={viewer} insights={insights} />
      </MyPageShell>
    </SiteShell>
  );
}
