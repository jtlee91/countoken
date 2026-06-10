"use client";

import { useState } from "react";
import { formatTokenAmount } from "@/lib/format/tokens";

const numberFormatter = new Intl.NumberFormat("ko-KR");

const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 12;

export function UsageCompositionCell({
  inputTokens,
  cacheTokens,
  outputTokens,
  totalTokens,
}: {
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
  totalTokens: number;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const safeTotal = Math.max(totalTokens, 1);
  const segments = [
    { label: "입력", value: inputTokens, color: "bg-code-blue" },
    { label: "캐시", value: cacheTokens, color: "bg-token-green" },
    { label: "출력", value: outputTokens, color: "bg-badge-gold" },
  ];

  const handleMove = (event: React.MouseEvent) => {
    setCursor({ x: event.clientX, y: event.clientY });
  };
  const handleLeave = () => setCursor(null);

  const flipX =
    cursor !== null && cursor.x + TOOLTIP_OFFSET_X + 240 > window.innerWidth;

  return (
    <div className="min-w-0">
      <div className="text-right font-mono text-sm font-black">
        <span
          className="cursor-default"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        >
          {formatTokenAmount(totalTokens)}
        </span>
      </div>
      <div
        className="mt-[2px] py-[5px]"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <div className="flex h-3.5 overflow-hidden rounded-full bg-surface-alt">
          {segments.map((segment) => (
            <span
              key={segment.label}
              className={`block h-full ${segment.color}`}
              style={{ width: `${(segment.value / safeTotal) * 100}%` }}
            />
          ))}
        </div>
      </div>
      {cursor ? (
        <div
          className="pointer-events-none fixed z-10 whitespace-nowrap rounded-lg border border-border bg-foreground px-3 py-2 text-xs font-extrabold leading-7 text-white shadow-lg"
          style={{
            left: flipX
              ? cursor.x - TOOLTIP_OFFSET_X
              : cursor.x + TOOLTIP_OFFSET_X,
            top: cursor.y - TOOLTIP_OFFSET_Y,
            transform: `translate(${flipX ? "-100%" : "0"}, -100%)`,
          }}
        >
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
