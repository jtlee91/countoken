"use client";

import {
  UsageBreakdownTooltip,
  useTooltipCursor,
} from "./usage-breakdown-tooltip";

export function AgentUsageBar({
  inputTokens,
  cacheTokens,
  outputTokens,
  totalTokens,
  sharePercent,
}: {
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
  totalTokens: number;
  sharePercent: number;
}) {
  const { cursor, handleMove, handleLeave } = useTooltipCursor();
  const safeTotal = Math.max(totalTokens, 1);
  const segments = [
    { label: "입력", value: inputTokens, color: "bg-code-blue" },
    { label: "캐시", value: cacheTokens, color: "bg-token-green" },
    { label: "출력", value: outputTokens, color: "bg-badge-gold" },
  ];

  return (
    <div
      className="-my-[5px] py-[5px]"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div
        className={`h-2 overflow-hidden rounded-full bg-surface-alt ${
          cursor ? "ring-2 ring-token-green/45" : ""
        }`}
      >
        <div
          className="flex h-full overflow-hidden rounded-full"
          style={{ width: `${Math.max(sharePercent, 1)}%` }}
        >
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
        <UsageBreakdownTooltip
          cursor={cursor}
          inputTokens={inputTokens}
          cacheTokens={cacheTokens}
          outputTokens={outputTokens}
          totalTokens={totalTokens}
        />
      ) : null}
    </div>
  );
}
