"use client";

import { useState } from "react";

import type { SessionModelCost } from "@/lib/data/models";
import {
  formatApproxUSD,
  formatCostSharePercent,
  formatUSD,
  roundSharesToTotal,
} from "@/lib/format/cost";

const numberFormatter = new Intl.NumberFormat("ko-KR");

const TOOLTIP_WIDTH = 320;
const TOOLTIP_OFFSET_X = 14;

// 라벨 열은 가장 긴 모델명(claude-sonnet-4-6)이 잘리지 않을 만큼 잡고, 나머지
// 세 열은 오른쪽으로 몰아 숫자끼리 정렬되게 한다.
const ROW_GRID = "grid grid-cols-[132px_52px_38px_52px] items-center gap-x-4";

export function SessionModelChip({
  model,
  modelCount,
  models,
  totalUSD,
  costPartial,
}: {
  model: string;
  modelCount: number;
  models: SessionModelCost[];
  totalUSD: number | null;
  // 요율이 없는 모델이 섞여 있으면 합계가 실제보다 작다. 숫자만 보여주면
  // 그 사실이 드러나지 않아서 합계 아래에 명시한다.
  costPartial: boolean;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  if (!model) {
    return null;
  }

  const extra = Math.max(modelCount - 1, 0);
  const flipX = cursor !== null &&
    cursor.x + TOOLTIP_OFFSET_X + TOOLTIP_WIDTH > window.innerWidth;

  // 모델별 금액을 각자 반올림하면 합이 총액과 1센트씩 어긋난다. 총액에 맞춰 배분.
  const priced = models.filter((entry) => entry.costUSD !== null);
  const pricedTotal = priced.reduce(
    (sum, entry) => sum + (entry.costUSD ?? 0),
    0,
  );
  const roundedByModel = new Map(
    roundSharesToTotal(
      priced.map((entry) => entry.costUSD ?? 0),
      totalUSD ?? pricedTotal,
    ).map((value, index) => [priced[index].model, value]),
  );

  return (
    <span className="relative inline-flex items-center gap-1">
      <span
        className="cursor-default rounded-[5px] border border-border bg-surface-alt px-1.5 py-px font-mono text-[10px] font-black text-muted"
        onMouseMove={(event) =>
          setCursor({ x: event.clientX, y: event.clientY })}
        onMouseLeave={() => setCursor(null)}
      >
        {model}
        {extra > 0 ? <span className="text-muted/70">{` +${extra}`}</span> : null}
      </span>
      {cursor
        ? (
          <div
            className="pointer-events-none fixed z-30 rounded-lg border border-border bg-foreground px-3.5 py-3 text-xs font-bold text-white shadow-lg"
            style={{
              width: TOOLTIP_WIDTH,
              left: flipX
                ? cursor.x - TOOLTIP_OFFSET_X
                : cursor.x + TOOLTIP_OFFSET_X,
              top: cursor.y + 16,
              transform: flipX ? "translateX(-100%)" : undefined,
            }}
          >
            <div className={`${ROW_GRID} text-[10px] font-extrabold uppercase tracking-[0.04em] text-white/45`}>
              <span>모델</span>
              <span className="text-right">호출</span>
              <span className="text-right">비중</span>
              <span className="text-right">금액</span>
            </div>
            <div className="my-2 border-t border-white/20" />
            {models.map((entry) => {
              const rounded = roundedByModel.get(entry.model);
              return (
                <div
                  key={entry.model}
                  className={`${ROW_GRID} py-[3px] leading-5`}
                >
                  <span className="truncate font-mono text-[11px]">
                    {entry.model}
                  </span>
                  <span className="text-right font-mono">
                    {numberFormatter.format(entry.llmCalls)}
                  </span>
                  <span className="text-right font-mono text-white/60">
                    {entry.costUSD === null || totalUSD === null
                      ? "—"
                      : `${formatCostSharePercent(entry.costUSD, totalUSD)}%`}
                  </span>
                  <span className="text-right font-mono">
                    {rounded === undefined ? "—" : formatUSD(rounded)}
                  </span>
                </div>
              );
            })}
            {totalUSD === null ? null : (
              <>
                <div className="my-2 border-t border-white/20" />
                <div className={`${ROW_GRID} leading-5`}>
                  <span className="text-white/60">합계</span>
                  <span />
                  <span />
                  <span className="text-right font-mono font-black">
                    {formatApproxUSD(totalUSD)}
                  </span>
                </div>
                {costPartial
                  ? (
                    <div className="mt-1.5 text-[10px] font-extrabold leading-4 text-white/45">
                      요율이 등록되지 않은 모델은 합계에서 빠져 있다
                    </div>
                  )
                  : null}
              </>
            )}
          </div>
        )
        : null}
    </span>
  );
}
