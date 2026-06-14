"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { UsageBreakdownPopover } from "./usage-breakdown-popover";

export type HeroMetricChip = {
  label: string;
  value: string;
  delta: { up: boolean; label: string; title: string } | null;
  counts: { sessions: string; prompts: string; llmCalls: string } | null;
  breakdown: {
    codexTokens: number;
    claudeTokens: number;
    inputTokens: number;
    cacheTokens: number;
    outputTokens: number;
  };
};

// 모바일 전용 — 기간 칩을 탭하면 해당 기간 지표만 크게 보여준다
export function HeroMetricsChips({ metrics }: { metrics: HeroMetricChip[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const active = metrics[activeIndex];

  if (!active) {
    return null;
  }

  const breakdownTotal =
    active.breakdown.inputTokens +
    active.breakdown.cacheTokens +
    active.breakdown.outputTokens;
  const canBreakdown = breakdownTotal > 0;
  const breakdownFooter = active.counts
    ? `세션 ${active.counts.sessions} · 프롬프트 ${active.counts.prompts} · 호출 ${active.counts.llmCalls}`
    : undefined;

  const countItems = active.counts
    ? [
        { label: "세션", value: active.counts.sessions },
        { label: "프롬프트", value: active.counts.prompts },
        { label: "LLM 호출", value: active.counts.llmCalls },
      ]
    : [];

  return (
    <div className="px-6 pb-2 pt-4 sm:hidden">
      <div className="flex gap-1.5" role="tablist" aria-label="기간 선택">
        {metrics.map((metric, index) => {
          const on = index === activeIndex;

          return (
            <button
              key={metric.label}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setActiveIndex(index);
                setBreakdownOpen(false);
              }}
              className={
                on
                  ? "rounded-full border border-token-green/35 bg-token-green/10 px-3.5 py-1.5 text-xs font-extrabold text-token-green"
                  : "rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-extrabold text-muted"
              }
            >
              {metric.label}
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <p className="flex flex-wrap items-baseline gap-x-2.5">
          {canBreakdown ? (
            <button
              type="button"
              aria-expanded={breakdownOpen}
              onClick={() => setBreakdownOpen((open) => !open)}
              className={`-mx-1.5 -my-0.5 flex items-baseline gap-1 rounded-lg px-1.5 py-0.5 font-mono text-[34px] font-black leading-tight ${
                breakdownOpen ? "bg-surface-alt" : ""
              }`}
            >
              {active.value}
              <ChevronDown
                size={16}
                className={`self-center text-muted transition-transform ${
                  breakdownOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>
          ) : (
            <span className="font-mono text-[34px] font-black leading-tight">
              {active.value}
            </span>
          )}
          {active.delta ? (
            <span
              title={active.delta.title}
              className={
                active.delta.up
                  ? "text-[13px] font-extrabold text-token-green"
                  : "text-[13px] font-extrabold text-alert-red"
              }
            >
              {active.delta.label}
            </span>
          ) : null}
        </p>
        {canBreakdown && breakdownOpen ? (
          <div className="mt-2.5 w-full max-w-[280px]">
            <UsageBreakdownPopover
              periodLabel={active.label}
              agents={{
                codexTokens: active.breakdown.codexTokens,
                claudeTokens: active.breakdown.claudeTokens,
              }}
              inputTokens={active.breakdown.inputTokens}
              cacheTokens={active.breakdown.cacheTokens}
              outputTokens={active.breakdown.outputTokens}
              footer={breakdownFooter}
            />
          </div>
        ) : null}
        {countItems.length > 0 ? (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {countItems.map((item) => (
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
        ) : null}
      </div>
    </div>
  );
}
