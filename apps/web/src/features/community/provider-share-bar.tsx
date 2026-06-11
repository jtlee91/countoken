"use client";

import { useEffect, useRef, useState } from "react";

import { formatTokenAmount } from "@/lib/format/tokens";

const CLAUDE_COLOR = "#d97757";
const CODEX_COLOR = "#10a37f";

function providerSplitBackground(claudeTokens: number, codexTokens: number) {
  const total = claudeTokens + codexTokens;

  if (total <= 0) {
    return "#9aa8a0";
  }

  // 한쪽이 극소량이어도 슬리버가 보이도록 4~96%로 클램프한다
  const rawPct = (claudeTokens / total) * 100;
  const claudePct =
    claudeTokens === 0
      ? 0
      : codexTokens === 0
        ? 100
        : Math.min(96, Math.max(4, Math.round(rawPct)));

  return `linear-gradient(90deg, ${CLAUDE_COLOR} 0 ${claudePct}%, ${CODEX_COLOR} ${claudePct}% 100%)`;
}

// 모바일 전용 프로바이더 비율 바 — 호버가 없는 터치 환경이므로 탭으로 상세를 토글한다
export function ProviderShareBar({
  claudeTokens,
  codexTokens,
}: {
  claudeTokens: number;
  codexTokens: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLButtonElement>(null);
  const total = claudeTokens + codexTokens;
  const claudePct = total > 0 ? Math.round((claudeTokens / total) * 100) : 0;
  const codexPct = total > 0 ? 100 - claudePct : 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (total <= 0) {
    return <div className="mt-2.5 h-2 rounded-full bg-background sm:hidden" />;
  }

  return (
    <button
      ref={rootRef}
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-label="에이전트별 사용량 상세 보기"
      className="relative mt-2.5 block h-2 w-full rounded-full bg-background sm:hidden"
    >
      <span
        className="block h-full overflow-hidden rounded-full"
        style={{
          background: providerSplitBackground(claudeTokens, codexTokens),
        }}
      />
      {open ? (
        <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 whitespace-nowrap rounded-lg bg-foreground px-3.5 py-2.5 text-left font-sans text-xs font-bold leading-6 text-white shadow-[0_10px_26px_rgba(29,45,37,0.28)]">
          <span className="flex items-center gap-2">
            <span
              className="size-2 rounded-[3px]"
              style={{ background: CLAUDE_COLOR }}
            />
            Claude Code {formatTokenAmount(claudeTokens)} · {claudePct}%
          </span>
          <span className="flex items-center gap-2">
            <span
              className="size-2 rounded-[3px]"
              style={{ background: CODEX_COLOR }}
            />
            Codex {formatTokenAmount(codexTokens)} · {codexPct}%
          </span>
        </span>
      ) : null}
    </button>
  );
}
