"use client";

import { useState } from "react";
import {
  formatTokenAmount,
  formatTokenSharePercent,
} from "@/lib/format/tokens";

const DONUT_RADIUS = 56;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export type CompositionItem = {
  label: string;
  value: number;
  stroke: string;
  dotClass: string;
};

// 토큰 구성 도넛 + 범례 — 조각/범례에 호버(데스크톱)하거나 탭(모바일)하면
// 해당 항목이 강조되고 가운데 숫자가 전체 → 해당 항목 값/비율로 바뀐다.
export function CompositionChart({
  items,
  total,
  totalLabel,
}: {
  items: CompositionItem[];
  total: number;
  totalLabel: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);

  const arcs = items.map((item) => ({
    ...item,
    length: total > 0 ? (item.value / total) * DONUT_CIRCUMFERENCE : 0,
  }));
  const offsets = arcs.map((_, index) =>
    arcs.slice(0, index).reduce((sum, arc) => sum + arc.length, 0),
  );

  const activeItem = active ? items.find((i) => i.label === active) : null;

  const hoverOn = (label: string) => {
    if (!pinned) {
      setActive(label);
    }
  };
  const hoverOff = () => {
    if (!pinned) {
      setActive(null);
    }
  };
  // 탭(모바일) / 클릭 고정 — 같은 항목을 다시 누르면 전체로 복귀
  const toggle = (label: string) => {
    if (pinned && active === label) {
      setPinned(false);
      setActive(null);
    } else {
      setPinned(true);
      setActive(label);
    }
  };

  return (
    <div className="flex items-center gap-6">
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
          {arcs.map((arc, index) => {
            const on = active === arc.label;
            return (
              <circle
                key={arc.label}
                cx="70"
                cy="70"
                r={DONUT_RADIUS}
                fill="none"
                stroke={arc.stroke}
                strokeWidth={on ? 24 : 18}
                strokeDasharray={`${arc.length} ${DONUT_CIRCUMFERENCE}`}
                strokeDashoffset={-offsets[index]}
                transform="rotate(-90 70 70)"
                className="cursor-pointer transition-[stroke-width,opacity] duration-150"
                style={{ opacity: active && !on ? 0.3 : 1 }}
                onMouseEnter={() => hoverOn(arc.label)}
                onMouseLeave={hoverOff}
                onClick={() => toggle(arc.label)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          {activeItem ? (
            <>
              <span
                className="font-mono text-[22px] font-black leading-none transition-colors"
                style={{ color: activeItem.stroke }}
              >
                {formatTokenAmount(activeItem.value)}
              </span>
              <span className="mt-1 text-[10px] font-extrabold tracking-[0.06em] text-muted">
                {activeItem.label} ·{" "}
                {formatTokenSharePercent(activeItem.value, total)}%
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-[22px] font-black leading-none">
                {totalLabel}
              </span>
              <span className="mt-1 text-[10px] font-extrabold tracking-[0.08em] text-muted">
                TOTAL
              </span>
            </>
          )}
        </div>
      </div>
      <div className="grid flex-1 gap-3">
        {items.map((item) => {
          const dimmed = active !== null && active !== item.label;
          return (
            <button
              key={item.label}
              type="button"
              onMouseEnter={() => hoverOn(item.label)}
              onMouseLeave={hoverOff}
              onClick={() => toggle(item.label)}
              className="-mx-2 cursor-pointer rounded-lg px-2 py-1 text-left transition-opacity"
              style={{ opacity: dimmed ? 0.4 : 1 }}
            >
              <div className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5">
                <span className={`h-2.5 w-2.5 rounded-[3px] ${item.dotClass}`} />
                <span className="text-[13px] font-extrabold">{item.label}</span>
                <span className="font-mono text-[13px] font-black">
                  {formatTokenSharePercent(item.value, total)}%
                </span>
              </div>
              <p className="ml-[22px] font-mono text-[11px] font-bold text-muted">
                {formatTokenAmount(item.value)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
