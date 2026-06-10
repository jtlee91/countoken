import "server-only";

import {
  grantEligibleBadgesForViewer,
  supabaseDataProvider,
} from "@/lib/data/supabase-provider";
import type { RankingPageData } from "@/lib/data/types";
import { getDataProviderMode, hasPublicSupabaseEnv } from "@/lib/env";
import {
  type BadgeDefinition,
  type DashboardData,
  type ViewerProfile,
} from "@/lib/data/models";

const emptyRankingPageData: RankingPageData = {
  entries: [],
  viewerBadges: [],
  viewerRanking: null,
  viewerWeeklyUsage: null,
  viewerShareSlug: null,
};

const emptyDashboardData: DashboardData = {
  todayTokens: 0,
  weeklyTokens: 0,
  totalTokens: 0,
  activeTurns: 0,
  totalLLMCalls: 0,
  activeSessions: 0,
  weeklyTurns: 0,
  weeklyLLMCalls: 0,
  weeklySessions: 0,
  monthlyTokens: 0,
  monthlyTurns: 0,
  monthlyLLMCalls: 0,
  monthlySessions: 0,
  prevWeekTokens: 0,
  prevMonthTokens: 0,
  connectedDevices: 0,
  weeklyRank: null,
  weeklyRankScore: null,
  lastUploadAt: null,
  tokenBreakdown: {
    input: 0,
    output: 0,
    cache: 0,
    total: 0,
  },
  dailyUsage: [],
  recentSessions: [],
  agents: [],
  devices: [],
};

function shouldUseSupabaseProvider() {
  return getDataProviderMode() === "supabase" && hasPublicSupabaseEnv();
}

export async function getRankingPageData(
  viewer?: ViewerProfile | null,
): Promise<RankingPageData> {
  if (!shouldUseSupabaseProvider()) {
    return emptyRankingPageData;
  }

  try {
    return await supabaseDataProvider.getRankingPageData(viewer);
  } catch {
    return emptyRankingPageData;
  }
}

export async function getDashboardData(
  viewer: ViewerProfile,
): Promise<DashboardData> {
  if (!viewer.userId || !shouldUseSupabaseProvider()) {
    return emptyDashboardData;
  }

  try {
    return await supabaseDataProvider.getDashboardData(viewer);
  } catch {
    return emptyDashboardData;
  }
}

export async function grantEligibleBadges() {
  if (!shouldUseSupabaseProvider()) {
    return;
  }

  try {
    await grantEligibleBadgesForViewer();
  } catch {
    // 부여 실패는 조회를 막지 않는다
  }
}

export async function getBadges(
  viewer?: ViewerProfile | null,
): Promise<BadgeDefinition[]> {
  if (!shouldUseSupabaseProvider()) {
    return [];
  }

  try {
    return await supabaseDataProvider.getBadges(viewer);
  } catch {
    return [];
  }
}

export async function getShareCard(publicSlug: string) {
  if (!shouldUseSupabaseProvider()) {
    return null;
  }

  try {
    return await supabaseDataProvider.getShareCard(publicSlug);
  } catch {
    return null;
  }
}
