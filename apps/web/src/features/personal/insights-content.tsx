import type { ViewerProfile } from "@/lib/data/models";
import type { Insight, InsightChart } from "@/lib/insights/types";

const DOW_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function WeekdayChart({ data, highlight }: { data: number[]; highlight: number }) {
  const max = Math.max(...data, 1);
  return (
    <div className="mt-3 grid h-[78px] grid-cols-7 items-end gap-1.5">
      {data.map((value, index) => {
        const on = index === highlight;
        return (
          <div
            key={index}
            className="flex h-full flex-col items-center justify-end gap-1.5"
          >
            <div
              className={`w-full max-w-[22px] rounded-t-[5px] ${
                on ? "bg-token-green" : "bg-surface-alt"
              }`}
              style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
            />
            <span
              className={`text-[10px] font-extrabold ${
                on ? "text-token-green" : "text-muted"
              }`}
            >
              {DOW_NAMES[index]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function HoursChart({ data, peak }: { data: number[]; peak: number }) {
  const max = Math.max(...data, 1);
  return (
    <>
      <div
        className="mt-3 grid h-12 items-end gap-[2px]"
        style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
      >
        {data.map((value, hour) => {
          const isPeak = hour === peak;
          const isDay = hour >= 8 && hour <= 17;
          return (
            <div
              key={hour}
              className={`rounded-[2px] ${
                isPeak
                  ? "bg-badge-gold"
                  : isDay
                    ? "bg-token-green/45"
                    : "bg-surface-alt"
              }`}
              style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] font-bold text-muted">
        <span>0시</span>
        <span>6시</span>
        <span>12시</span>
        <span>18시</span>
        <span>23시</span>
      </div>
    </>
  );
}

function InsightChartView({ chart }: { chart: InsightChart }) {
  if (chart.kind === "weekday") {
    return <WeekdayChart data={chart.data} highlight={chart.highlight} />;
  }
  return <HoursChart data={chart.data} peak={chart.peak} />;
}

// 차트가 있으면 넓게(3칸), 누적 기록은 풀폭, 나머지는 2칸
function cardSpan(insight: Insight) {
  if (insight.id === "milestone") return "lg:col-span-6";
  if (insight.chart) return "lg:col-span-3";
  return "lg:col-span-2";
}

export function InsightsContent({
  viewer,
  insights,
}: {
  viewer: ViewerProfile;
  insights: Insight[];
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-6 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
      <p className="text-sm font-extrabold text-token-green">
        마이페이지 · 인사이트
      </p>
      <h1 className="mt-1.5 text-xl font-black tracking-normal sm:text-[28px]">
        {viewer.displayName} 님의 사용 인사이트
      </h1>
      <p className="mt-2 text-sm font-bold leading-6 text-muted">
        쌓인 세션에서 자동으로 발견한 패턴이에요. 데이터가 늘수록 더 정확해져요.
      </p>

      {insights.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {insights.map((insight) => (
            <article
              key={insight.id}
              className={`col-span-1 rounded-lg border border-border bg-background p-4 sm:col-span-2 ${cardSpan(
                insight,
              )}`}
            >
              <span className="mb-2.5 flex items-center gap-1.5 text-[11px] font-black text-muted">
                <span className="text-sm">{insight.icon}</span>
              </span>
              <p className="text-[17px] font-black leading-tight">
                {insight.headline}
              </p>
              <p className="mt-2 text-xs font-bold leading-5 text-muted">
                {insight.sub}
              </p>
              {insight.chart ? (
                <InsightChartView chart={insight.chart} />
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-6 rounded-md border border-dashed border-border bg-background p-5 text-sm font-bold leading-6 text-muted">
          아직 보여드릴 인사이트가 충분하지 않아요. 세션이 며칠 더 쌓이면
          요일·시간대 패턴과 연속 사용 기록을 자동으로 정리해 드릴게요.
        </p>
      )}
    </section>
  );
}
