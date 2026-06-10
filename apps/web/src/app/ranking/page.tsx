import { SiteShell } from "@/components/site-shell";
import { RankingContent } from "@/features/community/ranking-content";
import { getAuthenticatedViewer } from "@/lib/auth/viewer";
import { getRankingPageData, grantEligibleBadges } from "@/lib/data";

export default async function RankingPage() {
  const authenticatedViewer = await getAuthenticatedViewer();

  if (authenticatedViewer) {
    await grantEligibleBadges();
  }

  const rankingData = await getRankingPageData(authenticatedViewer);

  return (
    <SiteShell activePath="/ranking" viewer={authenticatedViewer}>
      <RankingContent
        viewer={authenticatedViewer}
        entries={rankingData.entries}
        viewerBadges={rankingData.viewerBadges}
        viewerRanking={rankingData.viewerRanking}
        viewerWeeklyUsage={rankingData.viewerWeeklyUsage}
        viewerShareSlug={rankingData.viewerShareSlug}
      />
    </SiteShell>
  );
}
