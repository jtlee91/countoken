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

const AREA_WIDTH = 700;
const AREA_HEIGHT = 150;
const AREA_TOP = 12;
const AREA_BOTTOM = 148;

function buildAreaGeometry(values: number[]) {
  const max = Math.max(...values, 1);
  const step = AREA_WIDTH / Math.max(values.length - 1, 1);
  const points = values.map((value, index) => ({
    x: Math.round(index * step),
    y: Math.round(
      AREA_BOTTOM - (value / max) * (AREA_BOTTOM - AREA_TOP),
    ),
  }));

  let line = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = Math.round((prev.x + curr.x) / 2);
    line += ` C${midX},${prev.y} ${midX},${curr.y} ${curr.x},${curr.y}`;
  }

  const area = `${line} L${AREA_WIDTH},${AREA_HEIGHT} L0,${AREA_HEIGHT} Z`;
  const last = points[points.length - 1];

  return { line, area, last };
}

function DailyFlowChart({ values }: { values: number[] }) {
  const { line, area, last } = buildAreaGeometry(values);

  return (
    <svg
      viewBox={`0 0 ${AREA_WIDTH} ${AREA_HEIGHT}`}
      preserveAspectRatio="none"
      className="block h-[150px] w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id="daily-flow-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--token-green)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--token-green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#daily-flow-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--token-green)"
        strokeWidth="2.5"
      />
      <circle cx={last.x} cy={last.y} r="9" fill="var(--token-green)" opacity="0.2" />
      <circle cx={last.x} cy={last.y} r="5" fill="var(--token-green)" />
    </svg>
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

function todayDelta(dailyUsage: DashboardData["dailyUsage"]) {
  if (dailyUsage.length < 2) {
    return null;
  }

  const today = dailyUsage[dailyUsage.length - 1].totalTokens;
  const yesterday = dailyUsage[dailyUsage.length - 2].totalTokens;
  if (yesterday <= 0) {
    return null;
  }

  const percent = Math.round(((today - yesterday) / yesterday) * 100);
  return {
    up: percent >= 0,
    label: `${percent >= 0 ? "▲" : "▼"} ${Math.abs(percent)}% vs 어제`,
  };
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
      helper: delta ? (
        <span className={delta.up ? "text-token-green" : "text-alert-red"}>
          {delta.label}
        </span>
      ) : (
        "KST 기준 오늘 사용량"
      ),
    },
    {
      label: "이번 주",
      value: formatTokenAmount(dashboard.weeklyTokens),
      helper: `${numberFormatter.format(
        dashboard.weeklySessions,
      )} sessions · ${numberFormatter.format(dashboard.totalLLMCalls)} calls`,
    },
    {
      label: "전체",
      value: formatTokenAmount(dashboard.totalTokens),
      helper: `${numberFormatter.format(dashboard.activeSessions)} sessions`,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6">
          <div>
            <p className="text-sm font-extrabold text-token-green">
              My Page · Dashboard
            </p>
            <h1 className="mt-1.5 text-[28px] font-black tracking-normal">
              {viewer.displayName}의 개인 토큰 흐름
            </h1>
          </div>
          <div className="text-right text-xs font-bold text-muted">
            <p>
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-token-green" />
              마지막 sync{" "}
              <span className="font-mono font-black">
                {formatDateTime(dashboard.lastUploadAt)}
              </span>
            </p>
            <p className="mt-1">
              {numberFormatter.format(dashboard.totalLLMCalls)} LLM calls
              uploaded
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-0 px-6 pb-2 pt-4 sm:grid-cols-3">
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
              <p className="mt-1 text-xs font-extrabold text-muted">
                {metric.helper}
              </p>
            </div>
          ))}
        </div>

        {hasDailyUsage ? (
          <>
            <div className="px-6 pb-1.5">
              <DailyFlowChart
                values={dashboard.dailyUsage.map((day) => day.totalTokens)}
              />
            </div>
            <div
              className="grid px-6 pb-5 text-center"
              style={{
                gridTemplateColumns: `repeat(${dashboard.dailyUsage.length}, minmax(0, 1fr))`,
              }}
            >
              {dashboard.dailyUsage.map((day, index) => {
                const isToday = index === dashboard.dailyUsage.length - 1;

                return (
                  <div key={day.date}>
                    <p
                      className={`text-[11px] font-black ${
                        isToday ? "text-token-green" : ""
                      }`}
                    >
                      {day.label}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] font-extrabold text-muted">
                      {formatTokenAmount(day.totalTokens)}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
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
                    <div className="h-2 overflow-hidden rounded-full bg-surface-alt">
                      <div
                        className="h-full rounded-full bg-token-green"
                        style={{ width: `${Math.max(share, 1)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold text-muted">
                      <span>
                        {numberFormatter.format(agent.sessions)} sessions ·{" "}
                        {numberFormatter.format(agent.llmCalls)} calls
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
