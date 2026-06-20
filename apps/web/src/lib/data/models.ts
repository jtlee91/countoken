export type ViewerProfile = {
  userId?: string;
  displayName: string;
  initial: string;
  avatarUrl?: string | null;
  publicSlug?: string;
  rankPosition?: number;
  rankMovement?: string;
  weeklyScoreLabel?: string;
  topTenGapLabel?: string;
  rankingOptIn?: boolean;
  source?: "supabase";
};

export type RankingEntry = {
  rank: number;
  displayName: string;
  avatarUrl?: string | null;
  badgeName: string;
  movement: string;
  scoreLabel: string;
  claudeTokens: number;
  codexTokens: number;
};

export type ViewerRankingSummary = {
  rankPosition: number | null;
  rankMovement: string;
  scoreLabel: string | null;
  topTenGapLabel: string | null;
};

export type ViewerWeeklyUsageSummary = {
  tokens: number;
  sessions: number;
  lastUploadAt: string | null;
};

export type BadgeDefinition = {
  key: string;
  name: string;
  description: string;
  iconPath: string;
  earnedAt: string | null;
  progress: string;
};

export type DashboardAgentUsage = {
  agentType: string;
  agentLabel: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  activeTurns: number;
  sessions: number;
  llmCalls: number;
  lastUsedAt: string | null;
};

export type DashboardDevice = {
  id: string;
  label: string;
  status: "connected" | "pending" | "revoked";
  lastSeenAt: string | null;
};

export type DashboardTokenBreakdown = {
  input: number;
  output: number;
  cache: number;
  total: number;
};

export type DashboardDailyUsage = {
  date: string;
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  sessions: number;
};

// 한 세션 안에서 메인 턴 또는 서브에이전트 하나의 사용량 분해
export type SessionAgent = {
  agentKey: string;
  parentAgentKey: string;
  depth: number;
  labelType: string;
  labelText: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  llmCallCount: number;
  userTurnCount: number;
  startedAt: string | null;
  endedAt: string | null;
};

export type DashboardSession = {
  sessionHash: string;
  deviceId: string | null;
  deviceLabel: string;
  provider: string;
  providerLabel: string;
  startedAt: string;
  endedAt: string;
  userTurnCount: number;
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  localUpdatedAt: string;
  syncedAt: string | null;
  // 서브에이전트 분해. 2개 이상일 때만 펼침 UI를 노출한다(메인 턴 + 서브 N).
  agents: SessionAgent[];
};

// 기간별 에이전트/토큰 구성 분해 — 히어로 지표 호버 상세에 사용한다
export type UsageBreakdownSummary = {
  claudeTokens: number;
  codexTokens: number;
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
};

export type DashboardData = {
  todayTokens: number;
  todayTurns: number;
  todayLLMCalls: number;
  todaySessions: number;
  todayBreakdown: UsageBreakdownSummary;
  weeklyBreakdown: UsageBreakdownSummary;
  monthlyBreakdown: UsageBreakdownSummary;
  totalBreakdown: UsageBreakdownSummary;
  weeklyTokens: number;
  totalTokens: number;
  activeTurns: number;
  totalLLMCalls: number;
  activeSessions: number;
  weeklyTurns: number;
  weeklyLLMCalls: number;
  weeklySessions: number;
  monthlyTokens: number;
  monthlyTurns: number;
  monthlyLLMCalls: number;
  monthlySessions: number;
  prevWeekTokens: number;
  prevMonthTokens: number;
  connectedDevices: number;
  weeklyRank: number | null;
  weeklyRankScore: number | null;
  lastUploadAt: string | null;
  tokenBreakdown: DashboardTokenBreakdown;
  dailyUsage: DashboardDailyUsage[];
  recentSessions: DashboardSession[];
  agents: DashboardAgentUsage[];
  devices: DashboardDevice[];
};

export type ShareCard = {
  publicSlug: string;
  displayName: string;
  periodLabel: string;
  rankPosition: number | null;
  scoreLabel: string | null;
  serviceName: "Countoken";
  badges: BadgeDefinition[];
};
