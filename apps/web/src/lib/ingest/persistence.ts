import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { grantEligibleUsageBadges } from "@/lib/ingest/badge-grants";
import type { VerifiedDeviceContext } from "@/lib/ingest/device-credentials";
import { refreshWeeklyGlobalRankingSnapshot } from "@/lib/ingest/ranking-snapshots";
import type { SafeUsageEvent } from "@/lib/privacy/usage-payload";
import { createAdminClient } from "@/lib/supabase/admin";

export type UsagePersistenceResult =
  | {
      ok: true;
      persisted: boolean;
      duplicate: boolean;
    }
  | {
      ok: false;
      errorType: "storage_failed";
      safeMessage: string;
    };

type UsageSessionRow = {
  id: string;
};

type UsageTurnSummaryRow = {
  usage_session_id: string | null;
  device_id: string;
  agent_type: string;
  input_tokens: number;
  output_tokens: number;
};

function duplicateError(error: { code?: string; message?: string }) {
  return (
    error.code === "23505" ||
    error.message?.toLowerCase().includes("duplicate key")
  );
}

function usageDateInTimezone(value: string, timezone: string) {
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
    // Fall back to the UTC date when the collector timezone is unavailable.
  }

  return value.slice(0, 10);
}

function datePartsInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    day: Number(parts.find((part) => part.type === "day")?.value),
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value),
    second: Number(parts.find((part) => part.type === "second")?.value),
  };
}

function addUtcDays(usageDate: string, days: number) {
  const date = new Date(`${usageDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function zonedMidnightToUtc(usageDate: string, timezone: string) {
  const [year, month, day] = usageDate.split("-").map(Number);
  const targetUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const guess = new Date(targetUtc);
  const parts = datePartsInTimezone(guess, timezone);
  const values = [
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ];

  if (values.some((value) => Number.isNaN(value))) {
    throw new Error("invalid timezone date parts");
  }

  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = localAsUtc - guess.getTime();

  return new Date(targetUtc - offset);
}

function zonedDayRange(usageDate: string, timezone: string) {
  try {
    return {
      start: zonedMidnightToUtc(usageDate, timezone),
      end: zonedMidnightToUtc(addUtcDays(usageDate, 1), timezone),
    };
  } catch {
    const start = new Date(`${usageDate}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return { start, end };
  }
}

async function recordIngestError(
  supabase: SupabaseClient,
  context: VerifiedDeviceContext,
  event: SafeUsageEvent,
  errorType: string,
  safeMessage: string,
) {
  if (context.mode === "dry-run") {
    return;
  }

  try {
    await supabase.from("ingest_errors").insert({
      user_id: context.userId,
      device_id: context.deviceId,
      agent_type: event.agent_type,
      error_type: errorType.slice(0, 80),
      safe_message: safeMessage.slice(0, 200),
    });
  } catch {
    // Safe error logging must not make an accepted usage event fail.
  }
}

async function rebuildDailyUsageSummary(
  supabase: SupabaseClient,
  event: SafeUsageEvent,
  context: VerifiedDeviceContext,
) {
  if (context.mode === "dry-run") {
    return { ok: true };
  }

  const usageDate = usageDateInTimezone(
    event.turn_completed_at,
    event.timezone,
  );
  const { start, end } = zonedDayRange(usageDate, event.timezone);
  const { data, error } = await supabase
    .from("usage_turns")
    .select(
      "usage_session_id, device_id, agent_type, input_tokens, output_tokens",
    )
    .eq("user_id", context.userId)
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", end.toISOString());

  if (error) {
    return { ok: false };
  }

  const turns = (data ?? []) as UsageTurnSummaryRow[];
  const sessions = new Set(
    turns
      .map((turn) => turn.usage_session_id)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  const agents = new Set(turns.map((turn) => turn.agent_type));
  const devices = new Set(turns.map((turn) => turn.device_id));
  const totals = turns.reduce(
    (acc, turn) => ({
      inputTokens: acc.inputTokens + turn.input_tokens,
      outputTokens: acc.outputTokens + turn.output_tokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  const { error: upsertError } = await supabase
    .from("daily_usage_summaries")
    .upsert(
      {
        user_id: context.userId,
        usage_date: usageDate,
        timezone: event.timezone,
        input_tokens: totals.inputTokens,
        output_tokens: totals.outputTokens,
        active_turns: turns.length,
        active_sessions: sessions.size,
        connected_agents: agents.size,
        connected_devices: devices.size,
      },
      { onConflict: "user_id,usage_date,timezone" },
    );

  return { ok: !upsertError };
}

export async function persistUsageEvent(
  event: SafeUsageEvent,
  context: VerifiedDeviceContext,
): Promise<UsagePersistenceResult> {
  if (context.mode === "dry-run") {
    return {
      ok: true,
      persisted: false,
      duplicate: false,
    };
  }

  const supabase = createAdminClient();
  const { data: session, error: sessionError } = await supabase
    .from("usage_sessions")
    .upsert(
      {
        user_id: context.userId,
        device_id: context.deviceId,
        agent_installation_id: context.agentInstallationId,
        agent_type: event.agent_type,
        anonymized_session_id: event.anonymized_session_id,
        started_at: event.turn_started_at,
        last_activity_at: event.turn_completed_at,
        timezone: event.timezone,
      },
      {
        onConflict: "user_id,device_id,agent_type,anonymized_session_id",
      },
    )
    .select("id")
    .single<UsageSessionRow>();

  if (sessionError || !session) {
    await recordIngestError(
      supabase,
      context,
      event,
      "usage_session_failed",
      "Usage session could not be stored.",
    );

    return {
      ok: false,
      errorType: "storage_failed",
      safeMessage: "Usage session could not be stored.",
    };
  }

  const { error: turnError } = await supabase.from("usage_turns").insert({
    usage_session_id: session.id,
    user_id: context.userId,
    device_id: context.deviceId,
    agent_type: event.agent_type,
    occurred_at: event.turn_completed_at,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    cache_creation_tokens: event.cache_creation_tokens,
    cache_read_tokens: event.cache_read_tokens,
    user_message_count: event.user_message_count,
    assistant_message_count: event.assistant_message_count,
    collector_version: event.collector_version,
    event_fingerprint: event.event_fingerprint,
  });

  if (turnError) {
    if (duplicateError(turnError)) {
      return {
        ok: true,
        persisted: true,
        duplicate: true,
      };
    }

    await recordIngestError(
      supabase,
      context,
      event,
      "usage_turn_failed",
      "Usage turn could not be stored.",
    );

    return {
      ok: false,
      errorType: "storage_failed",
      safeMessage: "Usage turn could not be stored.",
    };
  }

  await Promise.all([
    supabase
      .from("devices")
      .update({ last_seen_at: event.turn_completed_at })
      .eq("id", context.deviceId),
    context.agentInstallationId
      ? supabase
          .from("agent_installations")
          .update({
            last_upload_at: event.turn_completed_at,
            status: "connected",
            collector_version: event.collector_version,
          })
          .eq("id", context.agentInstallationId)
      : Promise.resolve(),
  ]);

  const dailySummary = await rebuildDailyUsageSummary(supabase, event, context);
  if (!dailySummary.ok) {
    await recordIngestError(
      supabase,
      context,
      event,
      "daily_summary_failed",
      "Daily usage summary could not be refreshed.",
    );
  }

  const badgeGrants = await grantEligibleUsageBadges(
    supabase,
    context.userId,
    event,
  );
  if (!badgeGrants.ok) {
    await recordIngestError(
      supabase,
      context,
      event,
      "badge_grant_failed",
      "Usage badge grants could not be refreshed.",
    );
  }

  const ranking = await refreshWeeklyGlobalRankingSnapshot(supabase);
  if (!ranking.ok) {
    await recordIngestError(
      supabase,
      context,
      event,
      "ranking_refresh_failed",
      "Weekly ranking snapshot could not be refreshed.",
    );
  }

  return {
    ok: true,
    persisted: true,
    duplicate: false,
  };
}
