import type { DashboardData, ViewerProfile } from "@/lib/data/models";
import {
  formatTokenAmount,
  formatTokenSharePercent,
  tokenSharePercent,
} from "@/lib/format/tokens";
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
    .replace(/\s/g, "");
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

export function DashboardContent({
  viewer,
  dashboard,
}: {
  viewer: ViewerProfile;
  dashboard: DashboardData;
}) {
  const maxDailyTokens = Math.max(
    ...dashboard.dailyUsage.map((day) => day.totalTokens),
    1,
  );
  const hasDailyUsage = dashboard.dailyUsage.some((day) => day.totalTokens > 0);
  const breakdownItems = [
    {
      label: "Input",
      value: dashboard.tokenBreakdown.input,
      color: "bg-code-blue",
    },
    {
      label: "Cache",
      value: dashboard.tokenBreakdown.cache,
      color: "bg-token-green",
    },
    {
      label: "Output",
      value: dashboard.tokenBreakdown.output,
      color: "bg-badge-gold",
    },
  ];
  const metrics = [
    {
      label: "오늘",
      value: formatTokenAmount(dashboard.todayTokens),
      helper: "KST 기준 오늘 사용량",
    },
    {
      label: "이번 주",
      value: formatTokenAmount(dashboard.weeklyTokens),
      helper: `${numberFormatter.format(
        dashboard.weeklySessions,
      )} sessions · ${numberFormatter.format(dashboard.totalLLMCalls)} calls total`,
    },
    {
      label: "전체",
      value: formatTokenAmount(dashboard.totalTokens),
      helper: `${numberFormatter.format(
        dashboard.activeSessions,
      )} sessions · ${numberFormatter.format(dashboard.totalLLMCalls)} calls`,
    },
    {
      label: "마지막 sync",
      value: formatDateTime(dashboard.lastUploadAt),
      helper: `${numberFormatter.format(
        dashboard.totalLLMCalls,
      )} LLM calls uploaded`,
      compact: true,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <p className="text-sm font-extrabold text-token-green">
          My Page · Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
          {viewer.displayName}의 개인 토큰 흐름
        </h1>
        <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-muted">
          로컬 파서가 업로드한 일별 사용량 집계를 보여줍니다.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className="min-h-[152px] rounded-lg border border-border bg-surface p-5"
          >
            <p className="text-sm font-extrabold text-muted">{metric.label}</p>
            <p
              className={
                metric.compact
                  ? "mt-5 font-mono text-2xl font-black leading-tight"
                  : "mt-5 font-mono text-4xl font-black"
              }
            >
              {metric.value}
            </p>
            <p className="mt-3 text-sm font-bold leading-6 text-muted">
              {metric.helper}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">에이전트별 사용량</h2>
            <span className="rounded-full border border-code-blue/30 bg-code-blue/10 px-3 py-1 text-xs font-extrabold text-code-blue">
              {formatTokenAmount(dashboard.totalTokens)} total
            </span>
          </div>
          {dashboard.agents.length > 0 ? (
            <div className="divide-y divide-border">
              {dashboard.agents.map((agent) => (
                <div
                  key={agent.agentType}
                  className="py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-black">{agent.agentLabel}</p>
                      <p className="mt-1 text-xs font-bold text-muted">
                        마지막 사용 {formatDateTime(agent.lastUsedAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-lg font-black">
                        {formatTokenAmount(agent.totalTokens)}
                      </p>
                      <p className="mt-1 text-xs font-bold text-muted">
                        {numberFormatter.format(agent.sessions)} sessions ·{" "}
                        {numberFormatter.format(agent.llmCalls)} calls
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
              아직 에이전트별 사용량이 없습니다.
            </p>
          )}
        </article>

        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">토큰 구성</h2>
            <span className="rounded-full border border-code-blue/30 bg-code-blue/10 px-3 py-1 text-xs font-extrabold text-code-blue">
              input / cache / output
            </span>
          </div>
          {dashboard.tokenBreakdown.total > 0 ? (
            <div className="grid gap-4">
              {breakdownItems.map((item) => {
                const share = tokenSharePercent(
                  item.value,
                  dashboard.tokenBreakdown.total,
                );
                const shareLabel = formatTokenSharePercent(
                  item.value,
                  dashboard.tokenBreakdown.total,
                );

                return (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm font-extrabold">
                      <span>{item.label}</span>
                      <span className="font-mono">
                        {formatTokenAmount(item.value)} · {shareLabel}%
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-surface-alt">
                      <div
                        className={`h-full rounded-full ${item.color}`}
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
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
          <h2 className="text-xl font-black">최근 7일</h2>
          <span className="rounded-full border border-token-green/30 bg-token-green/10 px-3 py-1 text-xs font-extrabold text-token-green">
            KST
          </span>
        </div>
        {hasDailyUsage ? (
          <div className="grid min-h-[190px] grid-cols-7 items-end gap-2">
            {dashboard.dailyUsage.map((day) => {
              const height =
                day.totalTokens > 0
                  ? Math.max(
                      8,
                      Math.round((day.totalTokens / maxDailyTokens) * 120),
                    )
                  : 0;

              return (
                <div key={day.date} className="grid gap-2">
                  <div className="flex h-[132px] items-end rounded-md bg-surface-alt px-1.5 pb-1.5">
                    <div
                      className="w-full rounded-sm bg-token-green"
                      style={{ height }}
                      title={`${day.label} ${formatTokenAmount(day.totalTokens)}`}
                    />
                  </div>
                  <div className="min-h-[44px] text-center">
                    <p className="text-xs font-black">{day.label}</p>
                    <p className="mt-1 truncate font-mono text-[11px] font-extrabold text-muted">
                      {formatTokenAmount(day.totalTokens)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
            아직 usage_daily 데이터가 없습니다.
          </p>
        )}
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
                <col className="w-[14%]" />
                <col className="w-[36%]" />
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
