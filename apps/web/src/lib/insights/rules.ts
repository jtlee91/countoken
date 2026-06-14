import { formatTokenAmount } from "../format/tokens.ts";
import type { Insight, InsightMetrics } from "./types.ts";

const DOW_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

const PROVIDER_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

function sum(values: number[]) {
  return values.reduce((acc, v) => acc + v, 0);
}

function argmax(values: number[]) {
  let best = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best]) {
      best = i;
    }
  }
  return best;
}

function formatHour(hour: number) {
  if (hour === 0) return "오전 12시";
  if (hour < 12) return `오전 ${hour}시`;
  if (hour === 12) return "오후 12시";
  return `오후 ${hour - 12}시`;
}

// 누적 분포에서 양 끝 꼬리를 잘라 활동이 집중된 시간 구간을 구한다
function activeWindow(hourTokens: number[], lo = 0.1, hi = 0.9) {
  const total = sum(hourTokens);
  if (total <= 0) return null;
  let cum = 0;
  let start = 0;
  let end = 23;
  let startSet = false;
  for (let h = 0; h < 24; h += 1) {
    cum += hourTokens[h];
    if (!startSet && cum / total >= lo) {
      start = h;
      startSet = true;
    }
    if (cum / total <= hi) {
      end = h;
    }
  }
  return { start, end: Math.max(end, start) };
}

function daysBetween(a: string, b: string) {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

function koreaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // YYYY-MM-DD
}

type Rule = (m: InsightMetrics) => Insight | null;

// 요일 패턴 — 가장 많이 쓴 요일이 다른 요일 평균보다 두드러질 때
const peakWeekday: Rule = (m) => {
  const total = sum(m.dowTokens);
  if (total <= 0) return null;
  const i = argmax(m.dowTokens);
  const others = m.dowTokens.filter((_, idx) => idx !== i);
  const otherAvg = sum(others) / Math.max(others.length, 1);
  if (otherAvg <= 0) return null;
  const ratio = m.dowTokens[i] / otherAvg;
  if (ratio < 1.4) return null;
  const pct = Math.round((m.dowTokens[i] / total) * 100);
  return {
    id: "peak_weekday",
    icon: "📅",
    category: "요일 패턴",
    headline: `${DOW_NAMES[i]}요일이 가장 뜨거워요`,
    sub: `전체 사용량의 *${pct}%* — 다른 요일 평균의 *${ratio.toFixed(1)}배*`,
    score: 40 + ratio * 10,
    chart: { kind: "weekday", data: m.dowTokens, highlight: i },
  };
};

// 골든아워 — 가장 활발한 시간대와 활동 집중 구간
const goldenHour: Rule = (m) => {
  const total = sum(m.hourTokens);
  if (total <= 0) return null;
  const peak = argmax(m.hourTokens);
  const share = m.hourTokens[peak] / total;
  if (share < 0.1) return null;
  const win = activeWindow(m.hourTokens);
  const sub = win
    ? `활동의 대부분이 *${formatHour(win.start)}–${formatHour(win.end)}*에 집중돼요`
    : `하루 토큰의 *${Math.round(share * 100)}%*가 이 시간대에 몰려요`;
  return {
    id: "golden_hour",
    icon: "🕐",
    category: "골든아워",
    headline: `${formatHour(peak)}가 가장 활발해요`,
    sub,
    score: 30 + share * 40,
    chart: { kind: "hours", data: m.hourTokens, peak },
  };
};

// 연속 사용 스트릭 — 오늘(혹은 어제)까지 이어지는 연속일
const streak: Rule = (m) => {
  if (m.currentStreak < 3 || !m.lastActiveDate) return null;
  const sinceLast = daysBetween(m.lastActiveDate, koreaToday());
  if (sinceLast > 1) return null; // 이미 끊긴 스트릭은 "연속 중"이 아니다
  const isMax = m.currentStreak >= m.maxStreak;
  const sub = isMax
    ? `*${m.streakStart ?? ""}*부터 매일 — 최장 기록을 경신하고 있어요`.trim()
    : `*${m.streakStart ?? ""}*부터 매일 (최장 ${m.maxStreak}일)`.trim();
  return {
    id: "streak",
    icon: "🔥",
    category: "연속 사용",
    headline: `${m.currentStreak}일 연속 사용 중`,
    metric: { value: `${m.currentStreak}`, unit: "일" },
    sub,
    score: 50 + m.currentStreak * (isMax ? 4 : 2),
  };
};

// 에이전트 성향 — 한쪽으로 쏠려 있고, 소수 에이전트를 더 깊게 쓸 때
const agentStyle: Rule = (m) => {
  if (m.providers.length < 2) return null;
  const total = sum(m.providers.map((p) => p.tokens));
  if (total <= 0) return null;
  const sorted = [...m.providers].sort((a, b) => b.tokens - a.tokens);
  const [dom, sec] = sorted;
  const domShare = dom.tokens / total;
  if (domShare < 0.6) return null;
  const domPct = Math.round(domShare * 100);
  const secPct = Math.max(1, Math.round((sec.tokens / total) * 100));
  const deeper = sec.avgMinutes >= dom.avgMinutes * 1.4 && sec.avgMinutes > 0;
  const sub = deeper
    ? `${providerLabel(sec.provider)}는 ${secPct}%지만 세션당 평균 *${sec.avgMinutes}분*으로 더 깊게 써요`
    : `${providerLabel(sec.provider)} ${secPct}% · 세션당 평균 *${sec.avgMinutes}분*`;
  return {
    id: "agent_style",
    icon: "🤖",
    category: "에이전트 성향",
    headline: `${providerLabel(dom.provider)} ${domPct}%`,
    metric: { value: providerLabel(dom.provider), unit: `${domPct}%` },
    sub,
    score: 25 + (deeper ? 15 : 0),
  };
};

// 최고 기록일 — 하루 최고 사용량 (최근이면 "신기록"으로 가산)
const peakRecord: Rule = (m) => {
  if (!m.peakDay || m.peakDay.tokens <= 0) return null;
  const recent =
    m.lastActiveDate && daysBetween(m.peakDay.date, koreaToday()) <= 7;
  return {
    id: "peak_record",
    icon: "📈",
    category: "최고 기록일",
    headline: `하루 최고 ${formatTokenAmount(m.peakDay.tokens)}`,
    metric: { value: formatTokenAmount(m.peakDay.tokens) },
    sub: recent
      ? `*${m.peakDay.date}* — 최근 신기록을 세웠어요`
      : `*${m.peakDay.date}*에 기록한 역대 최고 사용량`,
    score: recent ? 45 : 20,
  };
};

// 야행성 — 밤 10시 이후 시작 세션 비중이 높을 때
const nightOwl: Rule = (m) => {
  if (!m.totals || m.totals.sessions <= 0) return null;
  const ratio = m.totals.nightSessions / m.totals.sessions;
  if (ratio < 0.2) return null;
  return {
    id: "night_owl",
    icon: "🦉",
    category: "야행성",
    headline: "야행성 코더",
    sub: `세션의 *${Math.round(ratio * 100)}%*를 밤 10시 이후에 시작했어요`,
    score: 22 + ratio * 20,
  };
};

const RULES: Rule[] = [
  peakWeekday,
  goldenHour,
  streak,
  agentStyle,
  peakRecord,
  nightOwl,
];

export function selectInsights(m: InsightMetrics, limit = 6): Insight[] {
  return RULES.map((rule) => rule(m))
    .filter((insight): insight is Insight => insight !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
