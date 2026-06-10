import type { DashboardData, ViewerProfile } from "@/lib/data/models";
import {
  formatTokenAmount,
  formatTokenSharePercent,
  tokenSharePercent,
} from "@/lib/format/tokens";
import { AgentUsageBar } from "./agent-usage-bar";
import { DailyFlowChart } from "./daily-flow-chart";
import { UsageCompositionCell } from "./usage-composition-cell";

const numberFormatter = new Intl.NumberFormat("ko-KR");

function formatDateTime(value: string | null) {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(value))
    .replace(/\s+/g, " ")
    // "06. 11." -> "06.11." (월·일은 붙이고 시간 앞 공백만 유지)
    .replace(/(\d{2})\. (\d{2})\./, "$1.$2.")
    .trim();
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

function formatSessionTime(startedAt: string, endedAt: string) {
  return `${formatDateTime(startedAt)} - ${formatDateTime(endedAt)}`;
}

function SessionTimeCell({
  startedAt,
  endedAt,
}: {
  startedAt: string;
  endedAt: string;
}) {
  return (
    <div
      className="grid min-w-0 grid-cols-[14px_minmax(0,1fr)] items-center gap-2"
      title={formatSessionTime(startedAt, endedAt)}
    >
      <div className="relative h-[54px]">
        <span className="absolute left-[6px] top-[9px] h-9 w-px rounded-full bg-border" />
        <span className="absolute left-[2px] top-[4px] h-2.5 w-2.5 rounded-full bg-foreground" />
        <span className="absolute bottom-[4px] left-[2px] h-2.5 w-2.5 rounded-full border-2 border-muted bg-surface" />
      </div>
      <div className="relative h-[54px] min-w-0">
        <div className="absolute left-0 right-0 top-[1px] flex h-4 min-w-0 items-center gap-2 whitespace-nowrap">
          <span className="w-10 shrink-0 text-[10px] font-black uppercase leading-none tracking-[0.08em] text-muted">
            Start
          </span>
          <span className="truncate font-mono text-[11px] font-black leading-none tracking-[0.05em] text-muted">
            {formatDateTime(startedAt)}
          </span>
        </div>
        <div className="absolute bottom-[1px] left-0 right-0 flex h-4 min-w-0 items-center gap-2 whitespace-nowrap">
          <span className="w-10 shrink-0 text-[10px] font-black uppercase leading-none tracking-[0.08em] text-muted">
            End
          </span>
          <span className="truncate font-mono text-[11px] font-black leading-none tracking-[0.05em] text-muted">
            {formatDateTime(endedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

const DONUT_RADIUS = 56;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function CompositionDonut({
  segments,
  totalLabel,
}: {
  segments: { label: string; value: number; stroke: string }[];
  totalLabel: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const arcs = segments.map((segment) => ({
    ...segment,
    length: total > 0 ? (segment.value / total) * DONUT_CIRCUMFERENCE : 0,
  }));
  const offsets = arcs.map((_, index) =>
    arcs.slice(0, index).reduce((sum, arc) => sum + arc.length, 0),
  );

  return (
    <div className="relative shrink-0">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle
          cx="70"
          cy="70"
          r={DONUT_RADIUS}
          fill="none"
          stroke="var(--surface-alt)"
          strokeWidth="18"
        />
        {arcs.map((arc, index) => (
          <circle
            key={arc.label}
            cx="70"
            cy="70"
            r={DONUT_RADIUS}
            fill="none"
            stroke={arc.stroke}
            strokeWidth="18"
            strokeDasharray={`${arc.length} ${DONUT_CIRCUMFERENCE}`}
            strokeDashoffset={-offsets[index]}
            transform="rotate(-90 70 70)"
          />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="font-mono text-[22px] font-black leading-none">
          {totalLabel}
        </span>
        <span className="mt-1 text-[10px] font-extrabold tracking-[0.08em] text-muted">
          TOTAL
        </span>
      </div>
    </div>
  );
}

function periodDelta(current: number, previous: number, vsLabel: string) {
  if (previous <= 0) {
    return null;
  }

  const percent = Math.round(((current - previous) / previous) * 100);
  return {
    up: percent >= 0,
    label: `${percent >= 0 ? "▲" : "▼"} ${Math.abs(percent)}% vs ${vsLabel}`,
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

function DeltaLine({
  delta,
}: {
  delta: { up: boolean; label: string } | null;
}) {
  if (!delta) {
    return null;
  }

  return (
    <p
      className={
        delta.up
          ? "mt-1.5 text-xs font-extrabold text-token-green"
          : "mt-1.5 text-xs font-extrabold text-alert-red"
      }
    >
      {delta.label}
    </p>
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
      label: "Cache",
      value: dashboard.tokenBreakdown.cache,
      stroke: "var(--token-green)",
      dotClass: "bg-token-green",
    },
    {
      label: "Input",
      value: dashboard.tokenBreakdown.input,
      stroke: "var(--code-blue)",
      dotClass: "bg-code-blue",
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
      value: formatTokenAmount(dashboard.todayTokens),
      delta,
      counts: null,
    },
    {
      label: "이번 주",
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
            <h1 className="mt-1.5 text-[28px] font-black tracking-normal">
              {viewer.displayName}의 개인 토큰 흐름
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

        <div className="grid grid-cols-1 gap-0 px-6 pb-2 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {heroMetrics.map((metric, index) => (
            <div
              key={metric.label}
              className={
                index === 0
                  ? "py-2 sm:pr-5"
                  : "border-t border-border py-2 sm:border-l sm:border-t-0 sm:px-5"
              }
            >
              <p className="text-xs font-extrabold text-muted">
                {metric.label}
              </p>
              <p className="mt-1.5 font-mono text-[34px] font-black leading-tight">
                {metric.value}
              </p>
              <DeltaLine delta={metric.delta} />
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
            <div className="flex items-center gap-6">
              <CompositionDonut
                segments={breakdownItems.map((item) => ({
                  label: item.label,
                  value: item.value,
                  stroke: item.stroke,
                }))}
                totalLabel={formatTokenAmount(dashboard.tokenBreakdown.total)}
              />
              <div className="grid flex-1 gap-3">
                {breakdownItems.map((item) => (
                  <div key={item.label}>
                    <div className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-[3px] ${item.dotClass}`}
                      />
                      <span className="text-[13px] font-extrabold">
                        {item.label}
                      </span>
                      <span className="font-mono text-[13px] font-black">
                        {formatTokenSharePercent(
                          item.value,
                          dashboard.tokenBreakdown.total,
                        )}
                        %
                      </span>
                    </div>
                    <p className="ml-[22px] font-mono text-[11px] font-bold text-muted">
                      {formatTokenAmount(item.value)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-0 text-left text-sm">
              <colgroup>
                <col className="w-[25%]" />
                <col className="w-[25%]" />
                <col className="w-[12%]" />
                <col className="w-[38%]" />
              </colgroup>
              <thead>
                <tr className="text-xs font-extrabold uppercase text-muted">
                  <th className="border-b border-border px-3 py-2">
                    에이전트 · 기기
                  </th>
                  <th className="border-b border-border px-3 py-2">
                    세션 시간
                  </th>
                  <th className="border-b border-border px-3 py-2 text-center">
                    프롬프트 · 호출
                  </th>
                  <th className="border-b border-border px-3 py-2 text-right">
                    총 사용량 · 구성
                  </th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentSessions.map((session) => (
                  <tr key={`${session.provider}-${session.sessionHash}`}>
                    <td className="border-b border-border px-3 py-3">
                      <span className="block font-black">
                        {session.providerLabel}
                      </span>
                      <span
                        className="mt-[3px] block max-w-[12rem] truncate text-[11px] font-extrabold text-muted"
                        title={session.deviceLabel}
                      >
                        {session.deviceLabel}
                      </span>
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      <SessionTimeCell
                        startedAt={session.startedAt}
                        endedAt={session.endedAt}
                      />
                    </td>
                    <td className="whitespace-nowrap border-b border-border px-3 py-3 text-center font-mono">
                      <span className="font-black">
                        {numberFormatter.format(session.userTurnCount)}
                      </span>
                      <span className="mx-1 text-border">·</span>
                      <span className="font-extrabold text-muted">
                        {numberFormatter.format(session.llmCallCount)}
                      </span>
                    </td>
                    <td className="border-b border-border px-3 py-3">
                      <UsageCompositionCell
                        inputTokens={session.inputTokens}
                        cacheTokens={session.cacheTokens}
                        outputTokens={session.outputTokens}
                        totalTokens={session.totalTokens}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
            세션 단위 데이터는 로컬에만 저장됩니다.
          </p>
        )}
      </section>
    </div>
  );
}
