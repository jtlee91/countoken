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
  summarizeViewerWeeklyUsage,
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

type WeeklyRankingRow = {
  rank_position: number;
  display_name: string;
  avatar_style: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  total_tokens: number;
  is_viewer: boolean | null;
};

function kstTodayDateString() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function getWeeklyRankingRows() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_weekly_ranking", {
    week_start: kstTodayDateString(),
  });

  if (error || !data) {
    return [];
  }

  return data as WeeklyRankingRow[];
}

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

type UsageDeviceRow = {
  device_id: string;
  device_label: string;
};

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

async function getViewerWeeklyUsage(userId?: string) {
  if (!userId) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
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
        "first_used_at",
        "last_used_at",
        "local_updated_at",
        "synced_at",
      ].join(","),
    )
    .eq("user_id", userId)
    .order("usage_date", { ascending: false })
    .limit(5000);

  if (error || !data) {
    return null;
  }

  return summarizeViewerWeeklyUsage(data as unknown as UsageDailyAggregateRow[]);
}

export async function grantEligibleBadgesForViewer() {
  if (!hasPublicSupabaseEnv()) {
    return;
  }

  const supabase = await createClient();
  await supabase.rpc("grant_eligible_badges");
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
            "device_id",
            "provider",
            "started_at",
            "ended_at",
            "user_turn_count",
            "llm_call_count",
            "input_tokens",
            "output_tokens",
            "cache_tokens",
            "local_updated_at",
            "synced_at",
          ].join(","),
        )
        .eq("user_id", viewer.userId)
        .order("ended_at", { ascending: false })
        .limit(5),
      getWeeklyRankingRows(),
    ]);

    const viewerRankingRow = rankingResult.find((row) => row.is_viewer) ?? null;
    const dailyRows = (dailyResult.data ?? []) as unknown as UsageDailyAggregateRow[];
    const sessionRows = (sessionsResult.data ??
      []) as unknown as UsageSessionAggregateRow[];
    const deviceIds = [
      ...new Set(
        sessionRows
          .map((session) => session.device_id)
          .filter((deviceId): deviceId is string => Boolean(deviceId)),
      ),
    ];
    let deviceLabelsById = new Map<string, string>();

    if (deviceIds.length > 0) {
      const devicesResult = await supabase
        .from("usage_devices")
        .select("device_id, device_label")
        .eq("user_id", viewer.userId)
        .in("device_id", deviceIds);

      deviceLabelsById = new Map(
        ((devicesResult.data ?? []) as UsageDeviceRow[]).map((device) => [
          device.device_id,
          device.device_label,
        ]),
      );
    }

    const enrichedSessionRows = sessionRows.map((session) => ({
      ...session,
      device_label: session.device_id
        ? (deviceLabelsById.get(session.device_id) ?? null)
        : null,
    }));
    const dashboard = summarizeUsageDailyDashboard(dailyRows, {
      recentSessionRows: enrichedSessionRows,
      recentSessionLimit: 5,
    });

    return {
      ...dashboard,
      weeklyRank: viewerRankingRow?.rank_position ?? null,
      weeklyRankScore: viewerRankingRow?.total_tokens ?? null,
    };
  },

  async getRankingPageData(viewer): Promise<RankingPageData> {
    if (!hasPublicSupabaseEnv()) {
      return {
        entries: [],
        viewerBadges: [],
        viewerRanking: null,
        viewerWeeklyUsage: null,
        viewerShareSlug: null,
      };
    }

    const supabase = await createClient();
    const [rankingRows, viewerWeeklyUsage] = await Promise.all([
      getWeeklyRankingRows(),
      getViewerWeeklyUsage(viewer?.userId),
    ]);

    const entries: RankingEntry[] = rankingRows
      .filter((row) => row.rank_position <= 10)
      .map((row) => ({
        rank: row.rank_position,
        displayName: row.display_name,
        badgeName: "미획득",
        movement: "Global weekly",
        scoreLabel: formatTokenAmount(row.total_tokens),
      }));

    const viewerRow = viewer?.userId
      ? (rankingRows.find((row) => row.is_viewer) ?? null)
      : null;
    const viewerRanking: ViewerRankingSummary | null = viewerRow
      ? {
          rankPosition: viewerRow.rank_position,
          rankMovement: "Global weekly",
          scoreLabel: formatTokenAmount(viewerRow.total_tokens),
          topTenGapLabel:
            viewerRow.rank_position <= 10
              ? "이번 주 Top 10 안에 있습니다."
              : "Top 10 진입까지 집계 대기 중입니다.",
        }
      : null;
    const viewerShareSlug =
      viewer?.userId && viewerRow
        ? ((
            await supabase
              .from("share_cards")
              .select("public_slug")
              .eq("user_id", viewer.userId)
              .eq("card_type", "ranking")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle<{ public_slug: string }>()
          ).data?.public_slug ?? null)
        : null;

    return {
      entries,
      viewerBadges: [],
      viewerRanking,
      viewerWeeklyUsage,
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
