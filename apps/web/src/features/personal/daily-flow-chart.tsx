"use client";

import { useState } from "react";
import type { DashboardDailyUsage } from "@/lib/data/models";
import { formatTokenAmount } from "@/lib/format/tokens";
import {
  UsageBreakdownTooltip,
  useTooltipCursor,
} from "./usage-breakdown-tooltip";

const numberFormatter = new Intl.NumberFormat("ko-KR");

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function koreaWeekday(dateKey: string) {
  // dateKey is a KST calendar date (YYYY-MM-DD); read it as UTC so the
  // weekday matches that exact day regardless of the viewer's timezone.
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[day];
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
    y: Math.round(AREA_BOTTOM - (value / max) * (AREA_BOTTOM - AREA_TOP)),
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

  return { line, area, last, points };
}

export function DailyFlowChart({ days }: { days: DashboardDailyUsage[] }) {
  const { cursor, handleMove, handleLeave } = useTooltipCursor();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { line, area, last, points } = buildAreaGeometry(
    days.map((day) => day.totalTokens),
  );
  const hoverDay = hoverIndex !== null ? days[hoverIndex] : null;
  const hoverPoint = hoverIndex !== null ? points[hoverIndex] : null;

  // 곡선 영역 어디서나 마우스를 움직이면 가장 가까운 날짜로 스냅한다
  const handlePlotMove = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.min(
      days.length - 1,
      Math.max(0, Math.round(ratio * Math.max(days.length - 1, 1))),
    );
    setHoverIndex(index);
    handleMove(event);
  };

  const resetHover = () => {
    setHoverIndex(null);
    handleLeave();
  };

  return (
    <div onMouseLeave={resetHover}>
      <div className="relative px-6 pb-1.5">
        <svg
          viewBox={`0 0 ${AREA_WIDTH} ${AREA_HEIGHT}`}
          preserveAspectRatio="none"
          className="block h-[150px] w-full cursor-crosshair"
          aria-hidden
          onMouseMove={handlePlotMove}
        >
          <defs>
            <linearGradient id="daily-flow-fill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--token-green)"
                stopOpacity="0.35"
              />
              <stop
                offset="100%"
                stopColor="var(--token-green)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#daily-flow-fill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--token-green)"
            strokeWidth="2.5"
          />
          {hoverIndex !== null ? (
            <line
              x1={(hoverIndex / Math.max(days.length - 1, 1)) * AREA_WIDTH}
              y1={AREA_TOP - 6}
              x2={(hoverIndex / Math.max(days.length - 1, 1)) * AREA_WIDTH}
              y2={AREA_HEIGHT}
              stroke="var(--muted)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          ) : null}
          <circle
            cx={last.x}
            cy={last.y}
            r="9"
            fill="var(--token-green)"
            opacity="0.2"
          />
          <circle cx={last.x} cy={last.y} r="5" fill="var(--token-green)" />
          {hoverPoint ? (
            <>
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r="9"
                fill="var(--token-green)"
                opacity="0.2"
              />
              <circle
                cx={hoverPoint.x}
                cy={hoverPoint.y}
                r="5"
                fill="var(--token-green)"
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </>
          ) : null}
        </svg>
      </div>
      <div
        className="grid px-6 pb-5 text-center"
        style={{
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {days.map((day, index) => {
          const isToday = index === days.length - 1;
          const isHovered = index === hoverIndex;

          return (
            <div
              key={day.date}
              className={`-my-1 cursor-default rounded-md py-1 ${
                isHovered ? "bg-surface-alt" : ""
              }`}
              onMouseEnter={() => setHoverIndex(index)}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
            >
              <p
                className={`text-[11px] font-black ${
                  isToday ? "text-token-green" : ""
                }`}
              >
                {day.label}{" "}
                <span
                  className={`font-extrabold ${isToday ? "" : "text-muted"}`}
                >
                  ({koreaWeekday(day.date)})
                </span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[10px] font-extrabold text-muted">
                {formatTokenAmount(day.totalTokens)}
              </p>
            </div>
          );
        })}
      </div>
      {cursor && hoverDay ? (
        <UsageBreakdownTooltip
          cursor={cursor}
          title={
            <>
              {hoverDay.label}{" "}
              <span className="text-white/75">
                ({koreaWeekday(hoverDay.date)})
              </span>{" "}
              · KST
            </>
          }
          inputTokens={hoverDay.inputTokens}
          cacheTokens={hoverDay.cacheTokens}
          outputTokens={hoverDay.outputTokens}
          totalTokens={hoverDay.totalTokens}
          footer={`${numberFormatter.format(hoverDay.sessions)} sessions`}
        />
      ) : null}
    </div>
  );
}
