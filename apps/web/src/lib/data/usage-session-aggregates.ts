import type {
  DashboardAgentUsage,
  DashboardDailyUsage,
  DashboardData,
  DashboardSession,
  DashboardTokenBreakdown,
} from "./models.ts";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UsageSessionAggregateRow = {
  session_hash: string;
  provider: string;
  started_at: string;
  ended_at: string;
  user_turn_count: number;
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  local_updated_at: string;
  synced_at: string | null;
};

export type UsageDailyAggregateRow = {
  usage_date: string;
  device_id: string | null;
  provider: string;
  model: string;
  session_count: number;
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  first_used_at: string;
  last_used_at: string;
  local_updated_at: string;
  synced_at: string | null;
};

type SummarizeOptions = {
  now?: Date;
  recentSessionLimit?: number;
};

type DailyUsageOptions = {
  now?: Date;
};

function providerLabel(provider: string) {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
    case "claude_code":
      return "Claude Code";
    default:
      return provider;
  }
}

function toKoreaDate(value: Date) {
  return new Date(value.getTime() + KOREA_OFFSET_MS);
}

function koreaDateKey(value: Date) {
  const koreaDate = toKoreaDate(value);
  const year = koreaDate.getUTCFullYear();
  const month = String(koreaDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(koreaDate.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function koreaDateLabel(dateKey: string) {
  return dateKey.slice(5).replace("-", "/");
}

function normalizeUsageDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return koreaDateKey(parsed);
  }

  return value.slice(0, 10);
}

function startOfKoreaToday(now: Date) {
  const koreaNow = toKoreaDate(now);

  return new Date(
    Date.UTC(
      koreaNow.getUTCFullYear(),
      koreaNow.getUTCMonth(),
      koreaNow.getUTCDate(),
    ) - KOREA_OFFSET_MS,
  );
}

function startOfKoreaWeek(now: Date) {
  const today = startOfKoreaToday(now);
  const koreaToday = toKoreaDate(today);
  const daysSinceMonday = (koreaToday.getUTCDay() + 6) % 7;

  return new Date(today.getTime() - daysSinceMonday * DAY_MS);
}

function maxTimestamp(...values: Array<string | null | undefined>) {
  const timestamps = values.filter((value): value is string => Boolean(value));

  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.reduce((latest, value) =>
    new Date(value).getTime() > new Date(latest).getTime() ? value : latest,
  );
}

function emptyBreakdown(): DashboardTokenBreakdown {
  return {
    input: 0,
    output: 0,
    cache: 0,
    reasoning: 0,
    total: 0,
  };
}

function addToBreakdown(
  breakdown: DashboardTokenBreakdown,
  row: UsageSessionAggregateRow,
) {
  breakdown.input += row.input_tokens;
  breakdown.output += row.output_tokens;
  breakdown.cache += row.cache_tokens;
  breakdown.reasoning += row.reasoning_tokens;
  breakdown.total += row.total_tokens;
}

function makeDailyUsage(now: Date) {
  const today = startOfKoreaToday(now);
  const days: DashboardDailyUsage[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * DAY_MS);
    const dateKey = koreaDateKey(date);
    days.push({
      date: dateKey,
      label: koreaDateLabel(dateKey),
      totalTokens: 0,
      sessions: 0,
    });
  }

  return days;
}

export function recentDailyUsageDateRange(options: DailyUsageOptions = {}) {
  const dailyUsage = makeDailyUsage(options.now ?? new Date());

  return {
    startDate: dailyUsage[0].date,
    endDate: dailyUsage[dailyUsage.length - 1].date,
  };
}

export function summarizeUsageDailyRows(
  rows: UsageDailyAggregateRow[],
  options: DailyUsageOptions = {},
) {
  const dailyUsage = makeDailyUsage(options.now ?? new Date());
  const dailyUsageByDate = new Map(dailyUsage.map((day) => [day.date, day]));

  for (const row of rows) {
    const daily = dailyUsageByDate.get(normalizeUsageDate(row.usage_date));
    if (!daily) {
      continue;
    }

    daily.totalTokens += row.total_tokens;
    daily.sessions += row.session_count;
  }

  return dailyUsage;
}

export function summarizeUsageDailyDashboard(
  rows: UsageDailyAggregateRow[],
  options: DailyUsageOptions = {},
): DashboardData {
  const now = options.now ?? new Date();
  const todayKey = koreaDateKey(startOfKoreaToday(now));
  const weekStartKey = koreaDateKey(startOfKoreaWeek(now));
  const tokenBreakdown = emptyBreakdown();
  const dailyUsage = makeDailyUsage(now);
  const dailyUsageByDate = new Map(dailyUsage.map((day) => [day.date, day]));
  const byAgent = new Map<string, DashboardAgentUsage>();
  const devices = new Set<string>();

  let todayTokens = 0;
  let weeklyTokens = 0;
  let totalTokens = 0;
  let activeSessions = 0;
  let totalLLMCalls = 0;
  let weeklySessions = 0;
  let lastUploadAt: string | null = null;

  for (const row of rows) {
    const usageDate = normalizeUsageDate(row.usage_date);
    totalTokens += row.total_tokens;
    activeSessions += row.session_count;
    totalLLMCalls += row.llm_call_count;
    tokenBreakdown.input += row.input_tokens;
    tokenBreakdown.output += row.output_tokens;
    tokenBreakdown.cache += row.cache_tokens;
    tokenBreakdown.reasoning += row.reasoning_tokens;
    tokenBreakdown.total += row.total_tokens;

    if (row.device_id) {
      devices.add(row.device_id);
    }

    if (usageDate === todayKey) {
      todayTokens += row.total_tokens;
    }

    if (usageDate >= weekStartKey) {
      weeklyTokens += row.total_tokens;
      weeklySessions += row.session_count;
    }

    const daily = dailyUsageByDate.get(usageDate);
    if (daily) {
      daily.totalTokens += row.total_tokens;
      daily.sessions += row.session_count;
    }

    const existing = byAgent.get(row.provider);
    byAgent.set(row.provider, {
      agentType: row.provider,
      agentLabel: providerLabel(row.provider),
      totalTokens: (existing?.totalTokens ?? 0) + row.total_tokens,
      activeTurns: 0,
      sessions: (existing?.sessions ?? 0) + row.session_count,
      llmCalls: (existing?.llmCalls ?? 0) + row.llm_call_count,
      lastUsedAt: maxTimestamp(existing?.lastUsedAt, row.last_used_at),
    });

    lastUploadAt = maxTimestamp(lastUploadAt, row.synced_at, row.local_updated_at);
  }

  return {
    todayTokens,
    weeklyTokens,
    totalTokens,
    activeTurns: 0,
    totalLLMCalls,
    activeSessions,
    weeklyTurns: 0,
    weeklySessions,
    connectedDevices: devices.size,
    weeklyRank: null,
    weeklyRankScore: null,
    lastUploadAt,
    tokenBreakdown,
    dailyUsage,
    recentSessions: [],
    agents: [...byAgent.values()].sort(
      (left, right) => right.totalTokens - left.totalTokens,
    ),
    devices: [],
  };
}

function toDashboardSession(row: UsageSessionAggregateRow): DashboardSession {
  return {
    sessionHash: row.session_hash,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    userTurnCount: row.user_turn_count,
    llmCallCount: row.llm_call_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheTokens: row.cache_tokens,
    reasoningTokens: row.reasoning_tokens,
    totalTokens: row.total_tokens,
    localUpdatedAt: row.local_updated_at,
    syncedAt: row.synced_at,
  };
}

export function summarizeUsageSessions(
  rows: UsageSessionAggregateRow[],
  options: SummarizeOptions = {},
): DashboardData {
  const now = options.now ?? new Date();
  const recentSessionLimit = options.recentSessionLimit ?? 12;
  const todayStart = startOfKoreaToday(now);
  const weekStart = startOfKoreaWeek(now);
  const tokenBreakdown = emptyBreakdown();
  const dailyUsage = makeDailyUsage(now);
  const dailyUsageByDate = new Map(dailyUsage.map((day) => [day.date, day]));
  const byAgent = new Map<string, DashboardAgentUsage>();

  let todayTokens = 0;
  let weeklyTokens = 0;
  let totalTokens = 0;
  let activeTurns = 0;
  let totalLLMCalls = 0;
  let weeklyTurns = 0;
  let weeklySessions = 0;
  let lastUploadAt: string | null = null;

  for (const row of rows) {
    const endedAt = new Date(row.ended_at);
    totalTokens += row.total_tokens;
    activeTurns += row.user_turn_count;
    totalLLMCalls += row.llm_call_count;
    addToBreakdown(tokenBreakdown, row);

    if (endedAt >= todayStart) {
      todayTokens += row.total_tokens;
    }

    if (endedAt >= weekStart) {
      weeklyTokens += row.total_tokens;
      weeklyTurns += row.user_turn_count;
      weeklySessions += 1;
    }

    const dateKey = koreaDateKey(endedAt);
    const daily = dailyUsageByDate.get(dateKey);
    if (daily) {
      daily.totalTokens += row.total_tokens;
      daily.sessions += 1;
    }

    const existing = byAgent.get(row.provider);
    byAgent.set(row.provider, {
      agentType: row.provider,
      agentLabel: providerLabel(row.provider),
      totalTokens: (existing?.totalTokens ?? 0) + row.total_tokens,
      activeTurns: (existing?.activeTurns ?? 0) + row.user_turn_count,
      sessions: (existing?.sessions ?? 0) + 1,
      llmCalls: (existing?.llmCalls ?? 0) + row.llm_call_count,
      lastUsedAt: maxTimestamp(existing?.lastUsedAt, row.ended_at),
    });

    lastUploadAt = maxTimestamp(lastUploadAt, row.synced_at, row.local_updated_at);
  }

  const recentSessions = [...rows]
    .sort(
      (left, right) =>
        new Date(right.ended_at).getTime() - new Date(left.ended_at).getTime(),
    )
    .slice(0, recentSessionLimit)
    .map(toDashboardSession);

  return {
    todayTokens,
    weeklyTokens,
    totalTokens,
    activeTurns,
    totalLLMCalls,
    activeSessions: rows.length,
    weeklyTurns,
    weeklySessions,
    connectedDevices: 0,
    weeklyRank: null,
    weeklyRankScore: null,
    lastUploadAt,
    tokenBreakdown,
    dailyUsage,
    recentSessions,
    agents: [...byAgent.values()].sort(
      (left, right) => right.totalTokens - left.totalTokens,
    ),
    devices: [],
  };
}
