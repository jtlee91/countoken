"use client";

import { useState } from "react";
import { formatTokenAmount } from "@/lib/format/tokens";

const numberFormatter = new Intl.NumberFormat("ko-KR");

const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 12;
const TOOLTIP_WIDTH = 240;

export type TooltipCursor = { x: number; y: number };

export function useTooltipCursor() {
  const [cursor, setCursor] = useState<TooltipCursor | null>(null);

  const handleMove = (event: React.MouseEvent) => {
    setCursor({ x: event.clientX, y: event.clientY });
  };
  const handleLeave = () => setCursor(null);

  return { cursor, handleMove, handleLeave };
}

export function UsageBreakdownTooltip({
  cursor,
  title,
  inputTokens,
  cacheTokens,
  outputTokens,
  totalTokens,
  footer,
}: {
  cursor: TooltipCursor;
  title?: React.ReactNode;
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
  totalTokens: number;
  footer?: string;
}) {
  const safeTotal = Math.max(totalTokens, 1);
  const segments = [
    { label: "입력", value: inputTokens, color: "bg-code-blue" },
    { label: "캐시", value: cacheTokens, color: "bg-token-green" },
    { label: "출력", value: outputTokens, color: "bg-badge-gold" },
  ];
  const flipX = cursor.x + TOOLTIP_OFFSET_X + TOOLTIP_WIDTH > window.innerWidth;

  return (
    <div
      className="pointer-events-none fixed z-10 whitespace-nowrap rounded-lg border border-border bg-foreground px-3 py-2 text-xs font-extrabold leading-7 text-white shadow-lg"
      style={{
        left: flipX ? cursor.x - TOOLTIP_OFFSET_X : cursor.x + TOOLTIP_OFFSET_X,
        top: cursor.y - TOOLTIP_OFFSET_Y,
        transform: `translate(${flipX ? "-100%" : "0"}, -100%)`,
      }}
    >
      {title ? (
        <div className="mb-1.5 border-b border-white/25 pb-1.5">{title}</div>
      ) : null}
      {segments.map((segment) => (
        <div key={segment.label}>
          <span
            className={`mr-1.5 inline-block h-2 w-2 rounded-full ${segment.color}`}
          />
          {segment.label}{" "}
          <span className="font-mono font-black">
            {formatTokenAmount(segment.value)}
          </span>{" "}
          ({((segment.value / safeTotal) * 100).toFixed(1)}%)
        </div>
      ))}
      <div className="mt-1.5 border-t border-white/25 pt-1.5">
        전체{" "}
        <span className="font-mono font-black">
          {numberFormatter.format(totalTokens)}
        </span>{" "}
        토큰
        {footer ? <span className="ml-1.5 text-white/70">· {footer}</span> : null}
      </div>
    </div>
  );
}
