import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SafeUsageEvent } from "@/lib/privacy/usage-payload";

const BADGE_GRANT_RULES = {
  tokenBurnerDailyTokens: 10000,
  multiAgentCount: 2,
  nightOwlStartHour: 22,
  nightOwlEndHour: 5,
  steadyFlameDays: 5,
  steadyFlameWindowDays: 7,
  cacheCrafterTokens: 500,
  cacheCrafterRatio: 0.2,
} as const;

const managedBadgeKeys = [
  "token-burner",
  "multi-agent-explorer",
  "night-owl",
  "steady-flame",
  "cache-crafter",
] as const;

type ManagedBadgeKey = (typeof managedBadgeKeys)[number];

type BadgeRow = {
  id: string;
  badge_key: ManagedBadgeKey;
};

type UserBadgeRow = {
  badge_id: string;
};

type UsageTurnRow = {
  agent_type: string;
  occurred_at: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
};

function startOfUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateInTimezone(value: string, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall back to UTC below for invalid or unsupported timezone labels.
  }

  return value.slice(0, 10);
}

function hourInTimezone(value: string, timezone: string) {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(value)),
    );
  } catch {
    return new Date(value).getUTCHours();
  }
}

function isNightOwlHour(hour: number) {
  return (
    hour >= BADGE_GRANT_RULES.nightOwlStartHour ||
    hour < BADGE_GRANT_RULES.nightOwlEndHour
  );
}

function compactEvidence(value: string) {
  return value.replace(/\s+/g, " ").slice(0, 160);
}

function usageTurnTotal(turn: UsageTurnRow) {
  return (
    turn.input_tokens +
    turn.output_tokens +
    turn.cache_creation_tokens +
    turn.cache_read_tokens
  );
}

export async function grantEligibleUsageBadges(
  supabase: SupabaseClient,
  userId: string,
  event: SafeUsageEvent,
) {
  const eventDate = dateInTimezone(event.turn_completed_at, event.timezone);
  const windowStart = startOfUtcDate(eventDate);
  windowStart.setUTCDate(
    windowStart.getUTCDate() - (BADGE_GRANT_RULES.steadyFlameWindowDays - 1),
  );

  const [badgesResult, existingResult, turnsResult] =
    await Promise.all([
      supabase
        .from("badges")
        .select("id, badge_key")
        .in("badge_key", [...managedBadgeKeys])
        .eq("active", true),
      supabase.from("user_badges").select("badge_id").eq("user_id", userId),
      supabase
        .from("usage_turns")
        .select(
          "agent_type, occurred_at, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens",
        )
        .eq("user_id", userId)
        .gte("occurred_at", windowStart.toISOString()),
    ]);

  if (
    badgesResult.error ||
    existingResult.error ||
    turnsResult.error
  ) {
    return { ok: false };
  }

  const badges = new Map(
    ((badgesResult.data ?? []) as BadgeRow[]).map((badge) => [
      badge.badge_key,
      badge,
    ]),
  );
  const earnedBadgeIds = new Set(
    ((existingResult.data ?? []) as UserBadgeRow[]).map(
      (badge) => badge.badge_id,
    ),
  );
  const turns = (turnsResult.data ?? []) as UsageTurnRow[];
  const agentTypes = new Set(turns.map((turn) => turn.agent_type));
  const nightTurns = turns.filter((turn) =>
    isNightOwlHour(hourInTimezone(turn.occurred_at, event.timezone)),
  );
  const cacheReadTokens = turns.reduce(
    (total, turn) => total + turn.cache_read_tokens,
    0,
  );
  const totalTokens = turns.reduce(
    (total, turn) => total + usageTurnTotal(turn),
    0,
  );
  const dailyTokens = new Map<string, number>();
  for (const turn of turns) {
    const usageDate = dateInTimezone(turn.occurred_at, event.timezone);
    dailyTokens.set(usageDate, (dailyTokens.get(usageDate) ?? 0) + usageTurnTotal(turn));
  }
  const activeDays = new Set(
    [...dailyTokens.entries()]
      .filter(([, total]) => total > 0)
      .map(([usageDate]) => usageDate),
  );
  const maxDailyTokens = Math.max(0, ...dailyTokens.values());

  const candidates: Partial<Record<ManagedBadgeKey, string>> = {};

  if (maxDailyTokens >= BADGE_GRANT_RULES.tokenBurnerDailyTokens) {
    candidates["token-burner"] = compactEvidence(
      `하루 사용량 ${maxDailyTokens.toLocaleString("en-US")} tokens`,
    );
  }

  if (agentTypes.size >= BADGE_GRANT_RULES.multiAgentCount) {
    candidates["multi-agent-explorer"] = compactEvidence(
      `서로 다른 ${agentTypes.size}개 에이전트 사용`,
    );
  }

  if (nightTurns.length > 0) {
    candidates["night-owl"] = compactEvidence(
      `최근 ${BADGE_GRANT_RULES.steadyFlameWindowDays}일 야간 사용 ${nightTurns.length}회`,
    );
  }

  if (activeDays.size >= BADGE_GRANT_RULES.steadyFlameDays) {
    candidates["steady-flame"] = compactEvidence(
      `최근 ${BADGE_GRANT_RULES.steadyFlameWindowDays}일 중 ${activeDays.size}일 사용`,
    );
  }

  if (
    cacheReadTokens >= BADGE_GRANT_RULES.cacheCrafterTokens ||
    (totalTokens > 0 &&
      cacheReadTokens / totalTokens >= BADGE_GRANT_RULES.cacheCrafterRatio)
  ) {
    candidates["cache-crafter"] = compactEvidence(
      `cache read ${cacheReadTokens.toLocaleString("en-US")} tokens`,
    );
  }

  const rows = Object.entries(candidates).flatMap(([badgeKey, evidence]) => {
    const badge = badges.get(badgeKey as ManagedBadgeKey);

    if (!badge || earnedBadgeIds.has(badge.id) || !evidence) {
      return [];
    }

    return {
      user_id: userId,
      badge_id: badge.id,
      evidence_summary: evidence,
    };
  });

  if (rows.length === 0) {
    return { ok: true };
  }

  const { error } = await supabase.from("user_badges").insert(rows);

  return { ok: !error };
}
