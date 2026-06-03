import type {
  BadgeDefinition,
  DashboardData,
  RankingEntry,
  ShareCard,
  ViewerProfile,
  ViewerRankingSummary,
} from "@/lib/data/models";

export type RankingPageData = {
  entries: RankingEntry[];
  viewerBadges: BadgeDefinition[];
  viewerRanking: ViewerRankingSummary | null;
  viewerShareSlug: string | null;
};

export type TokenPlaneDataProvider = {
  getRankingPageData(viewer?: ViewerProfile | null): Promise<RankingPageData>;
  getDashboardData(viewer: ViewerProfile): Promise<DashboardData>;
  getBadges(viewer?: ViewerProfile | null): Promise<BadgeDefinition[]>;
  getShareCard(publicSlug: string): Promise<ShareCard | null>;
};
