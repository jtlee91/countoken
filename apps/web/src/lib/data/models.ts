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
};

export type DashboardData = {
  todayTokens: number;
  todayTurns: number;
  todayLLMCalls: number;
  todaySessions: number;
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
  serviceName: "Token Plane";
  badges: BadgeDefinition[];
};
