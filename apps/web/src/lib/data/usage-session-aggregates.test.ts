import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recentDailyUsageDateRange,
  summarizeUsageDailyDashboard,
  summarizeUsageDailyRows,
  summarizeUsageSessions,
  type UsageDailyAggregateRow,
  type UsageSessionAggregateRow,
} from "./usage-session-aggregates.ts";

const rows: UsageSessionAggregateRow[] = [
  {
    session_hash: "codex-today",
    device_id: "device-a",
    device_label: "MacBook-Pro.local",
    provider: "codex",
    started_at: "2026-06-03T01:40:00.000Z",
    ended_at: "2026-06-03T02:00:00.000Z",
    user_turn_count: 2,
    llm_call_count: 5,
    input_tokens: 300,
    output_tokens: 100,
    cache_tokens: 600,
    local_updated_at: "2026-06-03T02:05:00.000Z",
    synced_at: "2026-06-03T02:06:00.000Z",
  },
  {
    session_hash: "claude-week",
    provider: "claude",
    started_at: "2026-06-02T09:40:00.000Z",
    ended_at: "2026-06-02T10:00:00.000Z",
    user_turn_count: 3,
    llm_call_count: 3,
    input_tokens: 100,
    output_tokens: 200,
    cache_tokens: 400,
    local_updated_at: "2026-06-02T10:05:00.000Z",
    synced_at: "2026-06-02T10:06:00.000Z",
  },
  {
    session_hash: "codex-old",
    provider: "codex",
    started_at: "2026-05-30T09:50:00.000Z",
    ended_at: "2026-05-30T10:00:00.000Z",
    user_turn_count: 1,
    llm_call_count: 1,
    input_tokens: 50,
    output_tokens: 50,
    cache_tokens: 400,
    local_updated_at: "2026-05-30T10:05:00.000Z",
    synced_at: "2026-05-30T10:06:00.000Z",
  },
];

function dailyRow(
  usageDate: string,
  overrides: Partial<UsageDailyAggregateRow>,
): UsageDailyAggregateRow {
  return {
    usage_date: usageDate,
    device_id: "device-a",
    provider: "codex",
    model: "",
    session_count: 1,
    llm_call_count: 1,
    input_tokens: 0,
    output_tokens: 0,
    cache_tokens: 0,
    first_used_at: `${usageDate}T00:00:00.000Z`,
    last_used_at: `${usageDate}T00:10:00.000Z`,
    local_updated_at: `${usageDate}T00:11:00.000Z`,
    synced_at: `${usageDate}T00:12:00.000Z`,
    ...overrides,
  };
}

test("summarizeUsageSessions aggregates usage_sessions with KST day and week boundaries", () => {
  const dashboard = summarizeUsageSessions(rows, {
    now: new Date("2026-06-03T03:00:00.000Z"),
  });

  assert.equal(dashboard.todayTokens, 1000);
  assert.equal(dashboard.weeklyTokens, 1700);
  assert.equal(dashboard.totalTokens, 2200);
  assert.equal(dashboard.activeSessions, 3);
  assert.equal(dashboard.activeTurns, 6);
  assert.equal(dashboard.totalLLMCalls, 9);
  assert.equal(dashboard.weeklySessions, 2);
  assert.equal(dashboard.weeklyTurns, 5);
  assert.equal(dashboard.lastUploadAt, "2026-06-03T02:06:00.000Z");

  assert.deepEqual(dashboard.tokenBreakdown, {
    input: 450,
    output: 350,
    cache: 1400,
    total: 2200,
  });

  assert.deepEqual(
    dashboard.agents.map((agent) => ({
      agentType: agent.agentType,
      totalTokens: agent.totalTokens,
      activeTurns: agent.activeTurns,
      sessions: agent.sessions,
      llmCalls: agent.llmCalls,
    })),
    [
      {
        agentType: "codex",
        totalTokens: 1500,
        activeTurns: 3,
        sessions: 2,
        llmCalls: 6,
      },
      {
        agentType: "claude",
        totalTokens: 700,
        activeTurns: 3,
        sessions: 1,
        llmCalls: 3,
      },
    ],
  );
});

test("summarizeUsageSessions returns recent sessions and daily totals for dashboard charts", () => {
  const dashboard = summarizeUsageSessions(rows, {
    now: new Date("2026-06-03T03:00:00.000Z"),
  });

  assert.equal(dashboard.dailyUsage.length, 7);
  assert.deepEqual(
    dashboard.dailyUsage.slice(-2).map((day) => ({
      date: day.date,
      totalTokens: day.totalTokens,
      sessions: day.sessions,
    })),
    [
      { date: "2026-06-02", totalTokens: 700, sessions: 1 },
      { date: "2026-06-03", totalTokens: 1000, sessions: 1 },
    ],
  );

  assert.deepEqual(
    dashboard.recentSessions.map((session) => ({
      sessionHash: session.sessionHash,
      provider: session.provider,
      providerLabel: session.providerLabel,
      deviceLabel: session.deviceLabel,
      totalTokens: session.totalTokens,
    })),
    [
      {
        sessionHash: "codex-today",
        provider: "codex",
        providerLabel: "Codex",
        deviceLabel: "MacBook-Pro.local",
        totalTokens: 1000,
      },
      {
        sessionHash: "claude-week",
        provider: "claude",
        providerLabel: "Claude Code",
        deviceLabel: "Unknown device",
        totalTokens: 700,
      },
      {
        sessionHash: "codex-old",
        provider: "codex",
        providerLabel: "Codex",
        deviceLabel: "Unknown device",
        totalTokens: 500,
      },
    ],
  );
});

test("summarizeUsageDailyRows aggregates usage_daily rows for the recent 7 days", () => {
  const dailyRows: UsageDailyAggregateRow[] = [
    dailyRow("2026-06-02", {
      session_count: 3,
      input_tokens: 100,
      output_tokens: 200,
      cache_tokens: 400,
    }),
    dailyRow("2026-06-02", {
      session_count: 2,
      input_tokens: 100,
      output_tokens: 100,
      cache_tokens: 100,
    }),
    dailyRow("2026-06-03", {
      session_count: 1,
      input_tokens: 300,
      output_tokens: 100,
      cache_tokens: 600,
    }),
    dailyRow("2026-05-25", {
      session_count: 9,
      input_tokens: 9999,
    }),
  ];

  const dailyUsage = summarizeUsageDailyRows(dailyRows, {
    now: new Date("2026-06-03T03:00:00.000Z"),
  });

  assert.equal(dailyUsage.length, 7);
  assert.deepEqual(
    dailyUsage.slice(-2).map((day) => ({
      date: day.date,
      totalTokens: day.totalTokens,
      sessions: day.sessions,
    })),
    [
      { date: "2026-06-02", totalTokens: 1000, sessions: 5 },
      { date: "2026-06-03", totalTokens: 1000, sessions: 1 },
    ],
  );
});

test("summarizeUsageDailyDashboard builds dashboard totals from usage_daily only", () => {
  const dashboard = summarizeUsageDailyDashboard(
    [
      dailyRow("2026-06-03", {
        provider: "codex",
        session_count: 2,
        llm_call_count: 5,
        input_tokens: 300,
        output_tokens: 100,
        cache_tokens: 600,
        last_used_at: "2026-06-03T02:00:00.000Z",
        synced_at: "2026-06-03T02:06:00.000Z",
      }),
      dailyRow("2026-06-02", {
        provider: "claude",
        device_id: "device-b",
        session_count: 3,
        llm_call_count: 3,
        input_tokens: 100,
        output_tokens: 200,
        cache_tokens: 400,
        last_used_at: "2026-06-02T10:00:00.000Z",
        synced_at: "2026-06-02T10:06:00.000Z",
      }),
      dailyRow("2026-05-30", {
        provider: "codex",
        session_count: 1,
        llm_call_count: 1,
        input_tokens: 50,
        output_tokens: 50,
        cache_tokens: 400,
        last_used_at: "2026-05-30T10:00:00.000Z",
      }),
    ],
    {
      now: new Date("2026-06-03T03:00:00.000Z"),
    },
  );

  assert.equal(dashboard.todayTokens, 1000);
  assert.equal(dashboard.weeklyTokens, 1700);
  assert.equal(dashboard.totalTokens, 2200);
  assert.equal(dashboard.activeSessions, 6);
  assert.equal(dashboard.totalLLMCalls, 9);
  assert.equal(dashboard.weeklySessions, 5);
  assert.equal(dashboard.weeklyTurns, 0);
  assert.equal(dashboard.activeTurns, 0);
  assert.equal(dashboard.connectedDevices, 2);
  assert.equal(dashboard.lastUploadAt, "2026-06-03T02:06:00.000Z");
  assert.equal(dashboard.recentSessions.length, 0);

  assert.deepEqual(dashboard.tokenBreakdown, {
    input: 450,
    output: 350,
    cache: 1400,
    total: 2200,
  });

  assert.deepEqual(
    dashboard.agents.map((agent) => ({
      agentType: agent.agentType,
      totalTokens: agent.totalTokens,
      sessions: agent.sessions,
      llmCalls: agent.llmCalls,
      activeTurns: agent.activeTurns,
    })),
    [
      {
        agentType: "codex",
        totalTokens: 1500,
        sessions: 3,
        llmCalls: 6,
        activeTurns: 0,
      },
      {
        agentType: "claude",
        totalTokens: 700,
        sessions: 3,
        llmCalls: 3,
        activeTurns: 0,
      },
    ],
  );
});

test("summarizeUsageDailyDashboard includes the 5 most recent usage_sessions by ended_at", () => {
  const sessionRows: UsageSessionAggregateRow[] = [
    rows[2],
    {
      ...rows[0],
      session_hash: "session-4",
      ended_at: "2026-06-03T04:00:00.000Z",
    },
    {
      ...rows[0],
      session_hash: "session-6",
      ended_at: "2026-06-03T06:00:00.000Z",
    },
    rows[0],
    rows[1],
    {
      ...rows[0],
      session_hash: "session-5",
      ended_at: "2026-06-03T05:00:00.000Z",
    },
    {
      ...rows[0],
      session_hash: "session-3",
      ended_at: "2026-06-03T03:00:00.000Z",
    },
  ];

  const dashboard = summarizeUsageDailyDashboard([], {
    now: new Date("2026-06-03T07:00:00.000Z"),
    recentSessionRows: sessionRows,
    recentSessionLimit: 5,
  });

  assert.deepEqual(
    dashboard.recentSessions.map((session) => session.sessionHash),
    ["session-6", "session-5", "session-4", "session-3", "codex-today"],
  );
});

test("recentDailyUsageDateRange returns the KST recent 7 day range", () => {
  assert.deepEqual(
    recentDailyUsageDateRange({
      now: new Date("2026-06-03T03:00:00.000Z"),
    }),
    {
      startDate: "2026-05-28",
      endDate: "2026-06-03",
    },
  );
});
