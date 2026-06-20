import type {
  DashboardAgentUsage,
  DashboardDailyUsage,
  DashboardData,
  DashboardSession,
  DashboardTokenBreakdown,
  SessionAgent,
  UsageBreakdownSummary,
} from "./models.ts";

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UsageSessionAgentRow = {
  agent_key: string;
  parent_agent_key: string;
  depth: number;
  label_type: string;
  label_text: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  llm_call_count: number;
  user_turn_count: number;
  started_at: string | null;
  ended_at: string | null;
};

export type UsageSessionAggregateRow = {
  session_hash: string;
  device_id?: string | null;
  device_label?: string | null;
  provider: string;
  started_at: string;
  ended_at: string;
  user_turn_count: number;
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  local_updated_at: string;
  synced_at: string | null;
  agents?: UsageSessionAgentRow[] | null;
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

type DailyDashboardOptions = DailyUsageOptions & {
  recentSessionRows?: UsageSessionAggregateRow[];
  recentSessionLimit?: number;
};

export type ViewerWeeklyUsage = {
  tokens: number;
  sessions: number;
  lastUploadAt: string | null;
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

function startOfKoreaMonth(now: Date) {
  const koreaNow = toKoreaDate(now);

  return new Date(
    Date.UTC(koreaNow.getUTCFullYear(), koreaNow.getUTCMonth(), 1) -
      KOREA_OFFSET_MS,
  );
}

function startOfKoreaPrevMonth(now: Date) {
  const koreaNow = toKoreaDate(now);

  return new Date(
    Date.UTC(koreaNow.getUTCFullYear(), koreaNow.getUTCMonth() - 1, 1) -
      KOREA_OFFSET_MS,
  );
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

function emptyPeriodBreakdown(): UsageBreakdownSummary {
  return {
    claudeTokens: 0,
    codexTokens: 0,
    inputTokens: 0,
    cacheTokens: 0,
    outputTokens: 0,
  };
}

function addToPeriodBreakdown(
  target: UsageBreakdownSummary,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cacheTokens: number,
) {
  const total = inputTokens + outputTokens + cacheTokens;

  if (provider === "claude" || provider === "claude_code") {
    target.claudeTokens += total;
  } else {
    target.codexTokens += total;
  }

  target.inputTokens += inputTokens;
  target.outputTokens += outputTokens;
  target.cacheTokens += cacheTokens;
}

function emptyBreakdown(): DashboardTokenBreakdown {
  return {
    input: 0,
    output: 0,
    cache: 0,
    total: 0,
  };
}

function rowTotalTokens(row: {
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
}) {
  return row.input_tokens + row.output_tokens + row.cache_tokens;
}

function addToBreakdown(
  breakdown: DashboardTokenBreakdown,
  row: UsageSessionAggregateRow,
) {
  const total = rowTotalTokens(row);

  breakdown.input += row.input_tokens;
  breakdown.output += row.output_tokens;
  breakdown.cache += row.cache_tokens;
  breakdown.total += total;
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
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
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

    daily.totalTokens += rowTotalTokens(row);
    daily.inputTokens += row.input_tokens;
    daily.outputTokens += row.output_tokens;
    daily.cacheTokens += row.cache_tokens;
    daily.sessions += row.session_count;
  }

  return dailyUsage;
}

export function summarizeViewerWeeklyUsage(
  rows: UsageDailyAggregateRow[],
  options: DailyUsageOptions = {},
): ViewerWeeklyUsage {
  const weekStartKey = koreaDateKey(startOfKoreaWeek(options.now ?? new Date()));
  let tokens = 0;
  let sessions = 0;
  let lastUploadAt: string | null = null;

  for (const row of rows) {
    if (normalizeUsageDate(row.usage_date) < weekStartKey) {
      continue;
    }

    tokens += rowTotalTokens(row);
    sessions += row.session_count;
    lastUploadAt = maxTimestamp(lastUploadAt, row.synced_at, row.local_updated_at);
  }

  return {
    tokens,
    sessions,
    lastUploadAt,
  };
}

export function summarizeUsageDailyDashboard(
  rows: UsageDailyAggregateRow[],
  options: DailyDashboardOptions = {},
): DashboardData {
  const now = options.now ?? new Date();
  const recentSessionLimit = options.recentSessionLimit ?? 5;
  const todayKey = koreaDateKey(startOfKoreaToday(now));
  const weekStartKey = koreaDateKey(startOfKoreaWeek(now));
  const monthStartKey = koreaDateKey(startOfKoreaMonth(now));
  const prevWeekStartKey = koreaDateKey(
    new Date(startOfKoreaWeek(now).getTime() - 7 * DAY_MS),
  );
  const prevMonthStartKey = koreaDateKey(startOfKoreaPrevMonth(now));
  const tokenBreakdown = emptyBreakdown();
  const dailyUsage = makeDailyUsage(now);
  const dailyUsageByDate = new Map(dailyUsage.map((day) => [day.date, day]));
  const byAgent = new Map<string, DashboardAgentUsage>();
  const devices = new Set<string>();

  let todayTokens = 0;
  let todaySessions = 0;
  let todayLLMCalls = 0;
  const todayBreakdown = emptyPeriodBreakdown();
  const weeklyBreakdown = emptyPeriodBreakdown();
  const monthlyBreakdown = emptyPeriodBreakdown();
  const totalBreakdown = emptyPeriodBreakdown();
  let weeklyTokens = 0;
  let totalTokens = 0;
  let activeSessions = 0;
  let totalLLMCalls = 0;
  let weeklySessions = 0;
  let weeklyLLMCalls = 0;
  let monthlyTokens = 0;
  let monthlySessions = 0;
  let monthlyLLMCalls = 0;
  let prevWeekTokens = 0;
  let prevMonthTokens = 0;
  let lastUploadAt: string | null = null;

  for (const row of rows) {
    const usageDate = normalizeUsageDate(row.usage_date);
    const rowTotal = rowTotalTokens(row);

    totalTokens += rowTotal;
    activeSessions += row.session_count;
    totalLLMCalls += row.llm_call_count;
    tokenBreakdown.input += row.input_tokens;
    tokenBreakdown.output += row.output_tokens;
    tokenBreakdown.cache += row.cache_tokens;
    tokenBreakdown.total += rowTotal;

    if (row.device_id) {
      devices.add(row.device_id);
    }

    addToPeriodBreakdown(
      totalBreakdown,
      row.provider,
      row.input_tokens,
      row.output_tokens,
      row.cache_tokens,
    );

    if (usageDate === todayKey) {
      todayTokens += rowTotal;
      todaySessions += row.session_count;
      todayLLMCalls += row.llm_call_count;
      addToPeriodBreakdown(
        todayBreakdown,
        row.provider,
        row.input_tokens,
        row.output_tokens,
        row.cache_tokens,
      );
    }

    if (usageDate >= weekStartKey) {
      weeklyTokens += rowTotal;
      weeklySessions += row.session_count;
      weeklyLLMCalls += row.llm_call_count;
      addToPeriodBreakdown(
        weeklyBreakdown,
        row.provider,
        row.input_tokens,
        row.output_tokens,
        row.cache_tokens,
      );
    }

    if (usageDate >= monthStartKey) {
      monthlyTokens += rowTotal;
      monthlySessions += row.session_count;
      monthlyLLMCalls += row.llm_call_count;
      addToPeriodBreakdown(
        monthlyBreakdown,
        row.provider,
        row.input_tokens,
        row.output_tokens,
        row.cache_tokens,
      );
    }

    if (usageDate >= prevWeekStartKey && usageDate < weekStartKey) {
      prevWeekTokens += rowTotal;
    }

    if (usageDate >= prevMonthStartKey && usageDate < monthStartKey) {
      prevMonthTokens += rowTotal;
    }

    const daily = dailyUsageByDate.get(usageDate);
    if (daily) {
      daily.totalTokens += rowTotal;
      daily.inputTokens += row.input_tokens;
      daily.outputTokens += row.output_tokens;
      daily.cacheTokens += row.cache_tokens;
      daily.sessions += row.session_count;
    }

    const existing = byAgent.get(row.provider);
    byAgent.set(row.provider, {
      agentType: row.provider,
      agentLabel: providerLabel(row.provider),
      totalTokens: (existing?.totalTokens ?? 0) + rowTotal,
      inputTokens: (existing?.inputTokens ?? 0) + row.input_tokens,
      outputTokens: (existing?.outputTokens ?? 0) + row.output_tokens,
      cacheTokens: (existing?.cacheTokens ?? 0) + row.cache_tokens,
      activeTurns: 0,
      sessions: (existing?.sessions ?? 0) + row.session_count,
      llmCalls: (existing?.llmCalls ?? 0) + row.llm_call_count,
      lastUsedAt: maxTimestamp(existing?.lastUsedAt, row.last_used_at),
    });

    lastUploadAt = maxTimestamp(lastUploadAt, row.synced_at, row.local_updated_at);
  }

  const recentSessions = [...(options.recentSessionRows ?? [])]
    .sort(
      (left, right) =>
        new Date(right.ended_at).getTime() - new Date(left.ended_at).getTime(),
    )
    .slice(0, recentSessionLimit)
    .map(toDashboardSession);

  return {
    todayTokens,
    todayTurns: 0,
    todayLLMCalls,
    todaySessions,
    todayBreakdown,
    weeklyBreakdown,
    monthlyBreakdown,
    totalBreakdown,
    weeklyTokens,
    totalTokens,
    activeTurns: 0,
    totalLLMCalls,
    activeSessions,
    weeklyTurns: 0,
    weeklyLLMCalls,
    weeklySessions,
    monthlyTokens,
    monthlyTurns: 0,
    monthlyLLMCalls,
    monthlySessions,
    prevWeekTokens,
    prevMonthTokens,
    connectedDevices: devices.size,
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

function toDashboardSession(row: UsageSessionAggregateRow): DashboardSession {
  const deviceLabel = row.device_label?.trim() || "Unknown device";

  return {
    sessionHash: row.session_hash,
    deviceId: row.device_id ?? null,
    deviceLabel,
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    userTurnCount: row.user_turn_count,
    llmCallCount: row.llm_call_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheTokens: row.cache_tokens,
    totalTokens: rowTotalTokens(row),
    localUpdatedAt: row.local_updated_at,
    syncedAt: row.synced_at,
    agents: toSessionAgents(row.agents),
  };
}

function toSessionAgents(
  rows: UsageSessionAgentRow[] | null | undefined,
): SessionAgent[] {
  if (!rows || rows.length === 0) {
    return [];
  }
  return rows
    .filter(
      // 토큰·호출이 모두 0인 에이전트는 노이즈(빈 스텁)라 숨긴다. 메인 턴은 항상 유지.
      (row) =>
        row.agent_key === "main" ||
        row.input_tokens + row.output_tokens + row.cache_tokens > 0 ||
        row.llm_call_count > 0,
    )
    .map((row) => ({
      agentKey: row.agent_key,
      parentAgentKey: row.parent_agent_key,
      depth: row.depth,
      labelType: row.label_type,
      labelText: row.label_text,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheTokens: row.cache_tokens,
      totalTokens: row.input_tokens + row.output_tokens + row.cache_tokens,
      llmCallCount: row.llm_call_count,
      userTurnCount: row.user_turn_count,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    }))
    .sort((a, b) => {
      // 메인 턴을 맨 위로, 그다음 깊이·시작시각 순
      if (a.agentKey === "main" && b.agentKey !== "main") return -1;
      if (b.agentKey === "main" && a.agentKey !== "main") return 1;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (a.startedAt ?? "").localeCompare(b.startedAt ?? "");
    });
}

export function summarizeUsageSessions(
  rows: UsageSessionAggregateRow[],
  options: SummarizeOptions = {},
): DashboardData {
  const now = options.now ?? new Date();
  const recentSessionLimit = options.recentSessionLimit ?? 12;
  const todayStart = startOfKoreaToday(now);
  const weekStart = startOfKoreaWeek(now);
  const monthStart = startOfKoreaMonth(now);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);
  const prevMonthStart = startOfKoreaPrevMonth(now);
  const tokenBreakdown = emptyBreakdown();
  const dailyUsage = makeDailyUsage(now);
  const dailyUsageByDate = new Map(dailyUsage.map((day) => [day.date, day]));
  const byAgent = new Map<string, DashboardAgentUsage>();

  let todayTokens = 0;
  let todayTurns = 0;
  let todaySessions = 0;
  let todayLLMCalls = 0;
  const todayBreakdown = emptyPeriodBreakdown();
  const weeklyBreakdown = emptyPeriodBreakdown();
  const monthlyBreakdown = emptyPeriodBreakdown();
  const totalBreakdown = emptyPeriodBreakdown();
  let weeklyTokens = 0;
  let totalTokens = 0;
  let activeTurns = 0;
  let totalLLMCalls = 0;
  let weeklyTurns = 0;
  let weeklySessions = 0;
  let weeklyLLMCalls = 0;
  let monthlyTokens = 0;
  let monthlyTurns = 0;
  let monthlySessions = 0;
  let monthlyLLMCalls = 0;
  let prevWeekTokens = 0;
  let prevMonthTokens = 0;
  let lastUploadAt: string | null = null;

  for (const row of rows) {
    const endedAt = new Date(row.ended_at);
    const rowTotal = rowTotalTokens(row);

    totalTokens += rowTotal;
    activeTurns += row.user_turn_count;
    totalLLMCalls += row.llm_call_count;
    addToBreakdown(tokenBreakdown, row);

    addToPeriodBreakdown(
      totalBreakdown,
      row.provider,
      row.input_tokens,
      row.output_tokens,
      row.cache_tokens,
    );

    if (endedAt >= todayStart) {
      todayTokens += rowTotal;
      todayTurns += row.user_turn_count;
      todaySessions += 1;
      todayLLMCalls += row.llm_call_count;
      addToPeriodBreakdown(
        todayBreakdown,
        row.provider,
        row.input_tokens,
        row.output_tokens,
        row.cache_tokens,
      );
    }

    if (endedAt >= weekStart) {
      weeklyTokens += rowTotal;
      weeklyTurns += row.user_turn_count;
      weeklySessions += 1;
      weeklyLLMCalls += row.llm_call_count;
      addToPeriodBreakdown(
        weeklyBreakdown,
        row.provider,
        row.input_tokens,
        row.output_tokens,
        row.cache_tokens,
      );
    }

    if (endedAt >= monthStart) {
      monthlyTokens += rowTotal;
      monthlyTurns += row.user_turn_count;
      monthlySessions += 1;
      monthlyLLMCalls += row.llm_call_count;
      addToPeriodBreakdown(
        monthlyBreakdown,
        row.provider,
        row.input_tokens,
        row.output_tokens,
        row.cache_tokens,
      );
    }

    if (endedAt >= prevWeekStart && endedAt < weekStart) {
      prevWeekTokens += rowTotal;
    }

    if (endedAt >= prevMonthStart && endedAt < monthStart) {
      prevMonthTokens += rowTotal;
    }

    const dateKey = koreaDateKey(endedAt);
    const daily = dailyUsageByDate.get(dateKey);
    if (daily) {
      daily.totalTokens += rowTotal;
      daily.inputTokens += row.input_tokens;
      daily.outputTokens += row.output_tokens;
      daily.cacheTokens += row.cache_tokens;
      daily.sessions += 1;
    }

    const existing = byAgent.get(row.provider);
    byAgent.set(row.provider, {
      agentType: row.provider,
      agentLabel: providerLabel(row.provider),
      totalTokens: (existing?.totalTokens ?? 0) + rowTotal,
      inputTokens: (existing?.inputTokens ?? 0) + row.input_tokens,
      outputTokens: (existing?.outputTokens ?? 0) + row.output_tokens,
      cacheTokens: (existing?.cacheTokens ?? 0) + row.cache_tokens,
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
    todayTurns,
    todayLLMCalls,
    todaySessions,
    todayBreakdown,
    weeklyBreakdown,
    monthlyBreakdown,
    totalBreakdown,
    weeklyTokens,
    totalTokens,
    activeTurns,
    totalLLMCalls,
    activeSessions: rows.length,
    weeklyTurns,
    weeklyLLMCalls,
    weeklySessions,
    monthlyTokens,
    monthlyTurns,
    monthlyLLMCalls,
    monthlySessions,
    prevWeekTokens,
    prevMonthTokens,
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
