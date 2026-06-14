// get_user_insights RPC가 돌려주는 원재료 지표 묶음
export type InsightMetrics = {
  dowTokens: number[]; // [일, 월, 화, 수, 목, 금, 토]
  hourTokens: number[]; // [0..23]
  currentStreak: number;
  maxStreak: number;
  streakStart: string | null;
  lastActiveDate: string | null;
  providers: {
    provider: string;
    tokens: number;
    sessions: number;
    turns: number;
    avgMinutes: number;
  }[];
  devices: {
    platform: string;
    label: string;
    tokens: number;
    sessions: number;
  }[];
  peakDay: { date: string; tokens: number } | null;
  totals: {
    sessions: number;
    turns: number;
    llmCalls: number;
    tokens: number;
    input: number;
    cache: number;
    output: number;
    nightSessions: number;
    firstDay: string | null;
    lastDay: string | null;
  } | null;
};

export type InsightChart =
  | { kind: "weekday"; data: number[]; highlight: number }
  | { kind: "hours"; data: number[]; peak: number };

// 룰을 통과한 하나의 인사이트 카드
export type Insight = {
  id: string;
  icon: string;
  headline: string;
  sub: string;
  score: number; // 게이트 통과 후 노출 우선순위
  chart?: InsightChart;
};

export function emptyInsightMetrics(): InsightMetrics {
  return {
    dowTokens: [0, 0, 0, 0, 0, 0, 0],
    hourTokens: Array.from({ length: 24 }, () => 0),
    currentStreak: 0,
    maxStreak: 0,
    streakStart: null,
    lastActiveDate: null,
    providers: [],
    devices: [],
    peakDay: null,
    totals: null,
  };
}
