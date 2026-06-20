import type {
  DashboardData,
  UsageBreakdownSummary,
  ViewerProfile,
} from "@/lib/data/models";
import {
  formatTokenAmount,
  formatTokenSharePercent,
  tokenSharePercent,
} from "@/lib/format/tokens";
import { AgentUsageBar } from "./agent-usage-bar";
import { CompositionChart } from "./composition-chart";
import { DailyFlowChart } from "./daily-flow-chart";
import { HeroMetricsChips } from "./hero-metrics-chips";
import { RecentSessionsAccordion } from "./recent-sessions-accordion";
import { RecentSessionsTable } from "./recent-sessions-table";

const numberFormatter = new Intl.NumberFormat("ko-KR");

function formatDateTime(value: string | null) {
  if (!value) {
    return "아직 없음";
  }

  return (
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      // 서버 로케일에 따라 오전/오후·AM/PM이 섞여 나오지 않도록 24시간제로 고정
      hourCycle: "h23",
    })
      .format(new Date(value))
      .replace(/\s+/g, " ")
      // "06. 11." -> "06.11." (월·일은 붙이고 시간 앞 공백만 유지)
      .replace(/(\d{2})\. (\d{2})\./, "$1.$2.")
      .trim()
  );
}

// 1,000 미만은 그대로, 이상은 K/M으로 축약 (44.0K -> 44K)
function formatCount(value: number) {
  if (value < 1000) {
    return numberFormatter.format(value);
  }

  return formatTokenAmount(value).replace(/\.0(?=[KMBT]$)/, "");
}

function formatLastSyncRelative(value: string | null) {
  if (!value) {
    return null;
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "방금 동기화됨";
  }
  if (minutes < 60) {
    return `${minutes}분 전 동기화`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전 동기화`;
  }

  return `${formatDateTime(value)} 동기화`;
}

// 베이스라인이 바닥일 때 퍼센트가 폭주(예: 어제 42.6K 대비 ▲433008%)하거나 0으로
// 나눌 수 없는 문제를 막기 위해 증가율은 999%에서 상한 처리한다.
const DELTA_CAP_PERCENT = 999;

function formatDeltaMagnitude(percent: number) {
  const magnitude = Math.abs(percent);
  return magnitude > DELTA_CAP_PERCENT ? `${DELTA_CAP_PERCENT}%+` : `${magnitude}%`;
}

function periodDelta(current: number, previous: number, vsLabel: string) {
  if (previous <= 0) {
    // 0으로는 나눌 수 없다. 직전이 0인데 늘었으면 상한값으로, 변화가 없으면 생략.
    if (current <= 0) {
      return null;
    }
    return {
      up: true,
      label: `▲ ${DELTA_CAP_PERCENT}%+`,
      title: `vs ${vsLabel}`,
    };
  }

  const percent = Math.round(((current - previous) / previous) * 100);
  return {
    up: percent >= 0,
    label: `${percent >= 0 ? "▲" : "▼"} ${formatDeltaMagnitude(percent)}`,
    title: `vs ${vsLabel}`,
  };
}

function todayDelta(dailyUsage: DashboardData["dailyUsage"]) {
  if (dailyUsage.length < 2) {
    return null;
  }

  return periodDelta(
    dailyUsage[dailyUsage.length - 1].totalTokens,
    dailyUsage[dailyUsage.length - 2].totalTokens,
    "어제",
  );
}

function InlineDelta({
  delta,
}: {
  delta: { up: boolean; label: string; title: string } | null;
}) {
  if (!delta) {
    return null;
  }

  return (
    <span
      title={delta.title}
      className={
        delta.up
          ? "text-[13px] font-extrabold text-token-green"
          : "text-[13px] font-extrabold text-alert-red"
      }
    >
      {delta.label}
    </span>
  );
}

const CLAUDE_COLOR = "#d97757";
const CODEX_COLOR = "#10a37f";

function TooltipRow({
  color,
  label,
  value,
  total,
}: {
  color: string;
  label: string;
  value: number;
  total: number;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="size-2 shrink-0 rounded-[3px]"
        style={{ background: color }}
      />
      {label}
      <span className="ml-auto font-mono">{formatTokenAmount(value)}</span>
      <span className="w-9 text-right font-mono text-white/60">
        {total > 0 ? Math.round((value / total) * 100) : 0}%
      </span>
    </span>
  );
}

// 히어로 지표 칼럼 호버 시 기간별 에이전트/토큰 구성 상세를 보여준다
function HeroBreakdownTooltip({
  periodLabel,
  breakdown,
}: {
  periodLabel: string;
  breakdown: UsageBreakdownSummary;
}) {
  const total =
    breakdown.inputTokens + breakdown.cacheTokens + breakdown.outputTokens;

  if (total <= 0) {
    return null;
  }

  return (
    <span className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-60 rounded-lg bg-foreground px-3.5 py-3 text-left text-xs font-bold leading-6 text-white shadow-[0_10px_26px_rgba(29,45,37,0.28)] group-hover:block group-focus-visible:block">
      <span className="block text-[10px] font-black tracking-[0.06em] text-white/50">
        {periodLabel} · 에이전트별
      </span>
      <TooltipRow
        color={CODEX_COLOR}
        label="Codex"
        value={breakdown.codexTokens}
        total={total}
      />
      <TooltipRow
        color={CLAUDE_COLOR}
        label="Claude Code"
        value={breakdown.claudeTokens}
        total={total}
      />
      <span className="my-2 block border-t border-white/15" />
      <span className="block text-[10px] font-black tracking-[0.06em] text-white/50">
        토큰 구성
      </span>
      <TooltipRow
        color="var(--code-blue)"
        label="입력"
        value={breakdown.inputTokens}
        total={total}
      />
      <TooltipRow
        color="var(--token-green)"
        label="캐시"
        value={breakdown.cacheTokens}
        total={total}
      />
      <TooltipRow
        color="var(--badge-gold)"
        label="출력"
        value={breakdown.outputTokens}
        total={total}
      />
    </span>
  );
}

function CountsRow({
  sessions,
  prompts,
  llmCalls,
}: {
  sessions: number;
  prompts: number;
  llmCalls: number;
}) {
  const items = [
    { label: "세션", value: formatCount(sessions) },
    { label: "프롬프트", value: formatCount(prompts) },
    { label: "LLM 호출", value: formatCount(llmCalls) },
  ];

  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div key={item.label}>
          <p className="font-mono text-[13px] font-black leading-none">
            {item.value}
          </p>
          <p className="mt-1 text-[10px] font-extrabold text-muted">
            {item.label}
          </p>
        </div>
      ))}
    </div>
  );
}

export function DashboardContent({
  viewer,
  dashboard,
}: {
  viewer: ViewerProfile;
  dashboard: DashboardData;
}) {
  const hasDailyUsage = dashboard.dailyUsage.some((day) => day.totalTokens > 0);
  const delta = todayDelta(dashboard.dailyUsage);
  const breakdownItems = [
    {
      label: "Input",
      value: dashboard.tokenBreakdown.input,
      stroke: "var(--code-blue)",
      dotClass: "bg-code-blue",
    },
    {
      label: "Cache",
      value: dashboard.tokenBreakdown.cache,
      stroke: "var(--token-green)",
      dotClass: "bg-token-green",
    },
    {
      label: "Output",
      value: dashboard.tokenBreakdown.output,
      stroke: "var(--badge-gold)",
      dotClass: "bg-badge-gold",
    },
  ];
  const heroMetrics = [
    {
      label: "오늘",
      breakdown: dashboard.todayBreakdown,
      value: formatTokenAmount(dashboard.todayTokens),
      delta,
      counts: {
        sessions: dashboard.todaySessions,
        prompts: dashboard.todayTurns,
        llmCalls: dashboard.todayLLMCalls,
      },
    },
    {
      label: "이번 주",
      breakdown: dashboard.weeklyBreakdown,
      value: formatTokenAmount(dashboard.weeklyTokens),
      delta: periodDelta(
        dashboard.weeklyTokens,
        dashboard.prevWeekTokens,
        "지난 주",
      ),
      counts: {
        sessions: dashboard.weeklySessions,
        prompts: dashboard.weeklyTurns,
        llmCalls: dashboard.weeklyLLMCalls,
      },
    },
    {
      label: "이번 달",
      breakdown: dashboard.monthlyBreakdown,
      value: formatTokenAmount(dashboard.monthlyTokens),
      delta: periodDelta(
        dashboard.monthlyTokens,
        dashboard.prevMonthTokens,
        "지난 달",
      ),
      counts: {
        sessions: dashboard.monthlySessions,
        prompts: dashboard.monthlyTurns,
        llmCalls: dashboard.monthlyLLMCalls,
      },
    },
    {
      label: "전체",
      breakdown: dashboard.totalBreakdown,
      value: formatTokenAmount(dashboard.totalTokens),
      delta: null,
      counts: {
        sessions: dashboard.activeSessions,
        prompts: dashboard.activeTurns,
        llmCalls: dashboard.totalLLMCalls,
      },
    },
  ];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6">
          <div>
            <p className="text-sm font-extrabold text-token-green">
              마이페이지 · 대시보드
            </p>
            <h1 className="mt-1.5 text-xl font-black tracking-normal sm:text-[28px]">
              {viewer.displayName} 님의 토큰 사용 흐름
            </h1>
          </div>
          <div className="text-right text-xs font-bold text-muted">
            <p className="group relative cursor-default" tabIndex={0}>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-token-green" />
              <span className="font-black tracking-wide">
                {formatLastSyncRelative(dashboard.lastUploadAt) ??
                  "동기화 대기 중"}
              </span>
              {dashboard.lastUploadAt ? (
                <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-lg bg-foreground px-3 py-2 font-mono text-xs font-bold tracking-wide text-white shadow-[0_10px_26px_rgba(29,45,37,0.28)] group-hover:block group-focus-visible:block">
                  {formatDateTime(dashboard.lastUploadAt)}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <HeroMetricsChips
          metrics={heroMetrics.map((metric) => ({
            label: metric.label,
            value: metric.value,
            delta: metric.delta,
            counts: metric.counts
              ? {
                  sessions: formatCount(metric.counts.sessions),
                  prompts: formatCount(metric.counts.prompts),
                  llmCalls: formatCount(metric.counts.llmCalls),
                }
              : null,
            breakdown: metric.breakdown,
          }))}
        />

        <div className="hidden grid-cols-1 gap-0 px-6 pb-2 pt-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          {heroMetrics.map((metric, index) => (
            <div
              key={metric.label}
              tabIndex={0}
              className={
                index === 0
                  ? "group relative cursor-default py-2 sm:pr-5"
                  : "group relative cursor-default border-t border-border py-2 sm:border-l sm:border-t-0 sm:px-5"
              }
            >
              <HeroBreakdownTooltip
                periodLabel={metric.label}
                breakdown={metric.breakdown}
              />
              <p className="text-xs font-extrabold text-muted">
                {metric.label}
              </p>
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5">
                <span className="font-mono text-[34px] font-black leading-tight">
                  {metric.value}
                </span>
                <InlineDelta delta={metric.delta} />
              </p>
              {metric.counts ? (
                <CountsRow
                  sessions={metric.counts.sessions}
                  prompts={metric.counts.prompts}
                  llmCalls={metric.counts.llmCalls}
                />
              ) : null}
            </div>
          ))}
        </div>

        {hasDailyUsage ? (
          <DailyFlowChart days={dashboard.dailyUsage} />
        ) : (
          <p className="mx-6 mb-6 rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
            아직 usage_daily 데이터가 없습니다.
          </p>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-black">에이전트별 사용량</h2>
            <span className="rounded-full border border-code-blue/30 bg-code-blue/10 px-3 py-1 text-xs font-extrabold text-code-blue">
              {formatTokenAmount(dashboard.totalTokens)} total
            </span>
          </div>
          {dashboard.agents.length > 0 ? (
            <div className="divide-y divide-border">
              {dashboard.agents.map((agent) => {
                const share = tokenSharePercent(
                  agent.totalTokens,
                  dashboard.totalTokens,
                );
                const shareLabel = formatTokenSharePercent(
                  agent.totalTokens,
                  dashboard.totalTokens,
                );

                return (
                  <div
                    key={agent.agentType}
                    className="grid gap-2 py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="text-sm font-black">
                        {agent.agentLabel}
                        <span className="ml-2 text-[11px] font-bold text-muted">
                          마지막 사용 {formatDateTime(agent.lastUsedAt)}
                        </span>
                      </p>
                      <p className="font-mono text-lg font-black">
                        {formatTokenAmount(agent.totalTokens)}
                      </p>
                    </div>
                    <AgentUsageBar
                      inputTokens={agent.inputTokens}
                      cacheTokens={agent.cacheTokens}
                      outputTokens={agent.outputTokens}
                      totalTokens={agent.totalTokens}
                      sharePercent={share}
                    />
                    <div className="flex items-center justify-between text-[11px] font-bold text-muted">
                      <span>
                        세션 {formatCount(agent.sessions)} · 프롬프트{" "}
                        {formatCount(agent.activeTurns)} · LLM 호출{" "}
                        {formatCount(agent.llmCalls)}
                      </span>
                      <span>전체의 {shareLabel}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
              아직 에이전트별 사용량이 없습니다.
            </p>
          )}
        </article>

        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-black">토큰 구성</h2>
          </div>
          {dashboard.tokenBreakdown.total > 0 ? (
            <CompositionChart
              items={breakdownItems}
              total={dashboard.tokenBreakdown.total}
              totalLabel={formatTokenAmount(dashboard.tokenBreakdown.total)}
            />
          ) : (
            <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
              아직 토큰 breakdown 데이터가 없습니다.
            </p>
          )}
        </article>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">최근 세션</h2>
          <div className="flex items-center gap-3.5 text-[11px] font-black text-muted">
            <span>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-code-blue" />
              입력
            </span>
            <span>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-token-green" />
              캐시
            </span>
            <span>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-badge-gold" />
              출력
            </span>
          </div>
        </div>
        {dashboard.recentSessions.length > 0 ? (
          <>
            <RecentSessionsAccordion sessions={dashboard.recentSessions} />
            <RecentSessionsTable sessions={dashboard.recentSessions} />
          </>
        ) : (
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
            세션 단위 데이터는 로컬에만 저장됩니다.
          </p>
        )}
      </section>
    </div>
  );
}
