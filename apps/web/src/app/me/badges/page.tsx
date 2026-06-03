import { MyPageShell } from "@/components/my-page-shell";
import { SiteShell } from "@/components/site-shell";
import { BadgesContent } from "@/features/community/badges-content";
import { LoginRequired } from "@/features/personal/login-required";
import { getViewerContext } from "@/lib/auth/viewer";
import { getBadges } from "@/lib/data";

export default async function MyBadgesPage() {
  const { viewer } = await getViewerContext();

  if (!viewer) {
    return (
      <SiteShell activePath="/me">
        <LoginRequired
          title="로그인이 필요합니다."
          description="배지 컬렉션은 Supabase Auth 세션과 연결된 계정 데이터만 표시합니다."
        />
      </SiteShell>
    );
  }

  const badges = await getBadges(viewer);

  return (
    <SiteShell activePath="/me" viewer={viewer}>
      <MyPageShell activeTab="badges" viewer={viewer}>
        <BadgesContent viewer={viewer} badges={badges} />
      </MyPageShell>
    </SiteShell>
  );
}
