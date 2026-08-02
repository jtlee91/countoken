"use client";

import { useState } from "react";
import { formatApproxUSD } from "@/lib/format/cost";
import { formatTokenAmount } from "@/lib/format/tokens";

const numberFormatter = new Intl.NumberFormat("ko-KR");

const TOOLTIP_OFFSET_X = 14;
const TOOLTIP_OFFSET_Y = 12;

export function UsageCompositionCell({
  inputTokens,
  cacheTokens,
  outputTokens,
  totalTokens,
  // 요율이 없는 모델은 null로 들어오고, 그때는 괄호 자체를 그리지 않는다.
  // "—" 같은 자리표시자는 값이 있는 줄과 섞이면 오히려 읽기 나쁘다.
  costUSD = null,
}: {
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUSD?: number | null;
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
    <div
      className="flex min-w-0 items-center justify-end gap-2.5"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {/* 토큰 위, 금액 아래. 폭을 고정해 두어야 모든 행의 막대가 같은 x에서
          시작한다. 금액이 없는 행은 자리를 비워 둘 뿐, 폭은 그대로 잡는다. */}
      <span className="flex w-[80px] shrink-0 cursor-default flex-col items-end whitespace-nowrap font-mono">
        <span className="text-sm font-black leading-5">
          {formatTokenAmount(totalTokens)}
        </span>
        {costUSD === null ? null : (
          <span className="text-[11px] font-extrabold leading-4 text-muted/70">
            {formatApproxUSD(costUSD)}
          </span>
        )}
      </span>
      <div className="-my-[5px] min-w-0 flex-1 py-[5px]">
        <div
          className={`flex h-3.5 overflow-hidden rounded-full bg-surface-alt ${
            cursor ? "ring-2 ring-token-green/45" : ""
          }`}
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
            {costUSD === null ? null : (
              <span className="ml-2 font-mono font-black text-white/70">
                {formatApproxUSD(costUSD)}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
