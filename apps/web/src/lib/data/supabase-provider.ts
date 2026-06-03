import "server-only";

import {
  type BadgeDefinition,
  type DashboardData,
  type RankingEntry,
  type ShareCard,
  type ViewerProfile,
  type ViewerRankingSummary,
} from "@/lib/data/models";
import type { RankingPageData, TokenPlaneDataProvider } from "@/lib/data/types";
import {
  summarizeUsageDailyDashboard,
  type UsageDailyAggregateRow,
  type UsageSessionAggregateRow,
} from "@/lib/data/usage-session-aggregates";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { formatTokenAmount } from "@/lib/format/tokens";
import { createClient } from "@/lib/supabase/server";

type BadgeRow = {
  id: string;
  badge_key: string;
  name: string;
  description: string;
  icon_path: string;
};

type RankingSnapshotRow = {
  user_id: string;
  rank_position: number;
  score: number;
};

type ProfileRow = {
  user_id: string;
  display_name: string;
};

type UserBadgeRow = {
  user_id: string;
  badge_id: string;
  earned_at: string;
  evidence_summary: string;
};

type ShareCardRow = {
  user_id: string;
  public_slug: string;
  card_type: string;
  expires_at: string | null;
};

function toViewerRankingSummary(
  snapshot?: RankingSnapshotRow | null,
): ViewerRankingSummary | null {
  if (!snapshot) {
    return null;
  }

  return {
    rankPosition: snapshot.rank_position,
    rankMovement: "Global weekly",
    scoreLabel: formatTokenAmount(snapshot.score),
    topTenGapLabel:
      snapshot.rank_position <= 10
        ? "이번 주 Top 10 안에 있습니다."
        : "Top 10 진입까지 집계 대기 중입니다.",
  };
}

function formatEarnedAt(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(value))
    .replace(/\s/g, "");
}

function toBadgeDefinition(
  badge: BadgeRow,
  grant?: UserBadgeRow,
): BadgeDefinition {
  return {
    key: badge.badge_key,
    name: badge.name,
    description: badge.description,
    iconPath: badge.icon_path,
    earnedAt: formatEarnedAt(grant?.earned_at ?? null),
    progress: grant?.evidence_summary ?? "아직 획득 전입니다.",
  };
}

async function getBadgeRowsById(ids: string[]) {
  if (ids.length === 0) {
    return new Map<string, BadgeRow>();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("badges")
    .select("id, badge_key, name, description, icon_path")
    .in("id", ids)
    .eq("active", true);

  if (error || !data) {
    return new Map<string, BadgeRow>();
  }

  return new Map((data as BadgeRow[]).map((badge) => [badge.id, badge]));
}

async function getProfilesByUserId(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, ProfileRow>();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);

  if (error || !data) {
    return new Map<string, ProfileRow>();
  }

  return new Map((data as ProfileRow[]).map((profile) => [profile.user_id, profile]));
}

async function getUserBadgeRows(userIds: string[]) {
  if (userIds.length === 0) {
    return [];
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_badges")
    .select("user_id, badge_id, earned_at, evidence_summary")
    .in("user_id", userIds)
    .order("earned_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as UserBadgeRow[];
}

export const supabaseDataProvider: TokenPlaneDataProvider = {
  async getDashboardData(viewer): Promise<DashboardData> {
    if (!hasPublicSupabaseEnv() || !viewer.userId) {
      return {
        todayTokens: 0,
        weeklyTokens: 0,
        totalTokens: 0,
        activeTurns: 0,
        totalLLMCalls: 0,
        activeSessions: 0,
        weeklyTurns: 0,
        weeklySessions: 0,
        connectedDevices: 0,
        weeklyRank: null,
        weeklyRankScore: null,
        lastUploadAt: null,
        tokenBreakdown: {
          input: 0,
          output: 0,
          cache: 0,
          reasoning: 0,
          total: 0,
        },
        dailyUsage: [],
        recentSessions: [],
        agents: [],
        devices: [],
      };
    }

    const supabase = await createClient();
    const [dailyResult, sessionsResult, rankingResult] = await Promise.all([
      supabase
        .from("usage_daily")
        .select(
          [
            "usage_date",
            "device_id",
            "provider",
            "model",
            "session_count",
            "llm_call_count",
            "input_tokens",
            "output_tokens",
            "cache_tokens",
            "reasoning_tokens",
            "total_tokens",
            "first_used_at",
            "last_used_at",
            "local_updated_at",
            "synced_at",
          ].join(","),
        )
        .eq("user_id", viewer.userId)
        .order("usage_date", { ascending: false })
        .limit(5000),
      supabase
        .from("usage_sessions")
        .select(
          [
            "session_hash",
            "provider",
            "started_at",
            "ended_at",
            "user_turn_count",
            "llm_call_count",
            "input_tokens",
            "output_tokens",
            "cache_tokens",
            "reasoning_tokens",
            "total_tokens",
            "local_updated_at",
            "synced_at",
          ].join(","),
        )
        .eq("user_id", viewer.userId)
        .order("ended_at", { ascending: false })
        .limit(5),
      supabase
        .from("ranking_snapshots")
        .select("rank_position, score")
        .eq("user_id", viewer.userId)
        .eq("period", "weekly")
        .eq("rank_scope", "global")
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ rank_position: number; score: number }>(),
    ]);

    const dailyRows = (dailyResult.data ?? []) as unknown as UsageDailyAggregateRow[];
    const sessionRows = (sessionsResult.data ??
      []) as unknown as UsageSessionAggregateRow[];
    const dashboard = summarizeUsageDailyDashboard(dailyRows, {
      recentSessionRows: sessionRows,
      recentSessionLimit: 5,
    });

    return {
      ...dashboard,
      weeklyRank: rankingResult.data?.rank_position ?? null,
      weeklyRankScore: rankingResult.data?.score ?? null,
    };
  },

  async getRankingPageData(viewer): Promise<RankingPageData> {
    if (!hasPublicSupabaseEnv()) {
      return {
        entries: [],
        viewerBadges: [],
        viewerRanking: null,
        viewerShareSlug: null,
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ranking_snapshots")
      .select("user_id, rank_position, score")
      .eq("period", "weekly")
      .eq("rank_scope", "global")
      .order("rank_position", { ascending: true })
      .limit(10);

    if (error || !data || data.length === 0) {
      return {
        entries: [],
        viewerBadges: [],
        viewerRanking: null,
        viewerShareSlug: null,
      };
    }

    const snapshots = data as RankingSnapshotRow[];
    const userIds = snapshots.map((snapshot) => snapshot.user_id);
    const [profiles, userBadges] = await Promise.all([
      getProfilesByUserId(userIds),
      getUserBadgeRows(userIds),
    ]);
    const badgeIds = [...new Set(userBadges.map((badge) => badge.badge_id))];
    const badges = await getBadgeRowsById(badgeIds);

    const entries: RankingEntry[] = snapshots.flatMap((snapshot) => {
      const profile = profiles.get(snapshot.user_id);

      if (!profile) {
        return [];
      }

      const firstBadgeGrant = userBadges.find(
        (badge) => badge.user_id === snapshot.user_id,
      );
      const badge = firstBadgeGrant
        ? badges.get(firstBadgeGrant.badge_id)
        : undefined;

      return {
        rank: snapshot.rank_position,
        displayName: profile.display_name,
        badgeName: badge?.name ?? "미획득",
        movement: "Global weekly",
        scoreLabel: formatTokenAmount(snapshot.score),
      };
    });

    const viewerBadges =
      viewer?.userId && userIds.includes(viewer.userId)
        ? userBadges
            .filter((grant) => grant.user_id === viewer.userId)
            .map((grant) => {
              const badge = badges.get(grant.badge_id);
              return badge ? toBadgeDefinition(badge, grant) : null;
            })
            .filter((badge): badge is BadgeDefinition => Boolean(badge))
        : [];
    const viewerSnapshot =
      viewer?.userId && userIds.includes(viewer.userId)
        ? snapshots.find((snapshot) => snapshot.user_id === viewer.userId)
        : viewer?.userId
          ? (
              await supabase
                .from("ranking_snapshots")
                .select("user_id, rank_position, score")
                .eq("user_id", viewer.userId)
                .eq("period", "weekly")
                .eq("rank_scope", "global")
                .order("calculated_at", { ascending: false })
                .limit(1)
                .maybeSingle<RankingSnapshotRow>()
            ).data
          : null;
    const viewerShareSlug =
      viewer?.userId && viewerSnapshot
        ? (
            await supabase
              .from("share_cards")
              .select("public_slug")
              .eq("user_id", viewer.userId)
              .eq("card_type", "ranking")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle<{ public_slug: string }>()
          ).data?.public_slug ?? null
        : null;

    return {
      entries,
      viewerBadges,
      viewerRanking: toViewerRankingSummary(viewerSnapshot),
      viewerShareSlug,
    };
  },

  async getBadges(viewer?: ViewerProfile | null) {
    if (!hasPublicSupabaseEnv()) {
      return [];
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("badges")
      .select("id, badge_key, name, description, icon_path")
      .eq("active", true)
      .order("created_at", { ascending: true });

    if (error || !data) {
      return [];
    }

    const badgeRows = data as BadgeRow[];
    const grants = viewer?.userId ? await getUserBadgeRows([viewer.userId]) : [];
    const grantsByBadgeId = new Map(grants.map((grant) => [grant.badge_id, grant]));

    return badgeRows.map((badge) =>
      toBadgeDefinition(badge, grantsByBadgeId.get(badge.id)),
    );
  },

  async getShareCard(publicSlug) {
    if (!hasPublicSupabaseEnv()) {
      return null;
    }

    const supabase = await createClient();
    const { data: card, error: cardError } = await supabase
      .from("share_cards")
      .select("user_id, public_slug, card_type, expires_at")
      .eq("public_slug", publicSlug)
      .maybeSingle<ShareCardRow>();

    if (cardError || !card) {
      return null;
    }

    const [profiles, rankingResult, grants] = await Promise.all([
      getProfilesByUserId([card.user_id]),
      supabase
        .from("ranking_snapshots")
        .select("rank_position, score")
        .eq("user_id", card.user_id)
        .eq("period", "weekly")
        .eq("rank_scope", "global")
        .order("calculated_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ rank_position: number; score: number }>(),
      getUserBadgeRows([card.user_id]),
    ]);
    const badgeRows = await getBadgeRowsById([
      ...new Set(grants.map((grant) => grant.badge_id)),
    ]);
    const ranking = rankingResult.data;

    const shareBadges = grants
      .map((grant) => {
        const badge = badgeRows.get(grant.badge_id);
        return badge ? toBadgeDefinition(badge, grant) : null;
      })
      .filter((badge): badge is BadgeDefinition => Boolean(badge));

    const profile = profiles.get(card.user_id);

    if (!profile) {
      return null;
    }

    const shareCard: ShareCard = {
      publicSlug: card.public_slug,
      displayName: profile.display_name,
      periodLabel: "Global weekly",
      rankPosition: ranking?.rank_position ?? null,
      scoreLabel: ranking ? formatTokenAmount(ranking.score) : null,
      serviceName: "Token Plane",
      badges: shareBadges,
    };

    return shareCard;
  },
};
