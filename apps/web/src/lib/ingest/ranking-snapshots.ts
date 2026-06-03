import "server-only";

import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

type RankingProfileRow = {
  user_id: string;
};

type RankingUsageTurnRow = {
  user_id: string;
  total_tokens: number;
};

type ShareCardRow = {
  user_id: string;
};

function startOfKoreaWeek() {
  const koreaOffsetMs = 9 * 60 * 60 * 1000;
  const koreaNow = new Date(Date.now() + koreaOffsetMs);
  const koreaTodayStart = new Date(
    Date.UTC(
      koreaNow.getUTCFullYear(),
      koreaNow.getUTCMonth(),
      koreaNow.getUTCDate(),
    ) - koreaOffsetMs,
  );
  const koreaToday = new Date(koreaTodayStart.getTime() + koreaOffsetMs);
  const daysSinceMonday = (koreaToday.getUTCDay() + 6) % 7;

  return new Date(
    koreaTodayStart.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000,
  );
}

function publicSlug() {
  return `tp-${randomBytes(9).toString("base64url")}`;
}

async function ensureRankingShareCards(
  supabase: SupabaseClient,
  userIds: string[],
) {
  if (userIds.length === 0) {
    return { ok: true };
  }

  const { data, error } = await supabase
    .from("share_cards")
    .select("user_id")
    .eq("card_type", "ranking")
    .in("user_id", userIds);

  if (error) {
    return { ok: false };
  }

  const existingUserIds = new Set(
    ((data ?? []) as ShareCardRow[]).map((card) => card.user_id),
  );
  const rows = userIds
    .filter((userId) => !existingUserIds.has(userId))
    .map((userId) => ({
      user_id: userId,
      card_type: "ranking",
      public_slug: publicSlug(),
    }));

  if (rows.length === 0) {
    return { ok: true };
  }

  const { error: insertError } = await supabase.from("share_cards").insert(rows);

  return { ok: !insertError };
}

export async function refreshWeeklyGlobalRankingSnapshot(
  supabase: SupabaseClient,
) {
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("ranking_opt_in", true);

  if (profilesError) {
    return { ok: false };
  }

  const optedInProfiles = (profiles ?? []) as RankingProfileRow[];
  const userIds = optedInProfiles.map((profile) => profile.user_id);
  const totalsByUser = new Map<string, number>();

  if (userIds.length > 0) {
    const { data: turns, error: turnsError } = await supabase
      .from("usage_turns")
      .select("user_id, total_tokens")
      .gte("occurred_at", startOfKoreaWeek().toISOString())
      .in("user_id", userIds);

    if (turnsError) {
      return { ok: false };
    }

    for (const turn of (turns ?? []) as RankingUsageTurnRow[]) {
      totalsByUser.set(
        turn.user_id,
        (totalsByUser.get(turn.user_id) ?? 0) + turn.total_tokens,
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("ranking_snapshots")
    .delete()
    .eq("period", "weekly")
    .eq("rank_scope", "global");

  if (deleteError) {
    return { ok: false };
  }

  const calculatedAt = new Date().toISOString();
  const rows = [...totalsByUser.entries()]
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([userId, score], index) => ({
      user_id: userId,
      period: "weekly",
      rank_scope: "global",
      rank_position: index + 1,
      score,
      calculated_at: calculatedAt,
    }));

  if (rows.length === 0) {
    return { ok: true };
  }

  const { error: insertError } = await supabase
    .from("ranking_snapshots")
    .insert(rows);

  if (insertError) {
    return { ok: false };
  }

  return ensureRankingShareCards(
    supabase,
    rows.map((row) => row.user_id),
  );
}
