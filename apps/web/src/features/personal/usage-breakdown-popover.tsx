import { formatTokenAmount } from "@/lib/format/tokens";

const numberFormatter = new Intl.NumberFormat("ko-KR");

const CLAUDE_COLOR = "#d97757";
const CODEX_COLOR = "#10a37f";

function PopoverRow({
  color,
  label,
  value,
  total,
}: {
  color: string;
  label: string;
  value: number;
  total: number;
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="size-2 shrink-0 rounded-[3px]"
        style={{ background: color }}
      />
      {label}
      <span className="ml-auto font-mono">{formatTokenAmount(value)}</span>
      <span className="w-9 text-right font-mono text-white/60">
        {total > 0 ? Math.round((value / total) * 100) : 0}%
      </span>
    </span>
  );
}

// 모바일 탭 토글용 다크 팝오버 — 토큰 구성(+선택적 에이전트별)과 합계를 보여준다
export function UsageBreakdownPopover({
  periodLabel,
  agents,
  inputTokens,
  cacheTokens,
  outputTokens,
  footer,
}: {
  periodLabel?: string;
  agents?: { codexTokens: number; claudeTokens: number };
  inputTokens: number;
  cacheTokens: number;
  outputTokens: number;
  footer?: string;
}) {
  const total = inputTokens + cacheTokens + outputTokens;

  return (
    <span className="block rounded-lg bg-foreground px-3.5 py-3 text-left text-xs font-bold leading-6 text-white shadow-[0_10px_26px_rgba(29,45,37,0.28)]">
      {agents ? (
        <>
          <span className="block text-[10px] font-black tracking-[0.06em] text-white/50">
            {periodLabel ? `${periodLabel} · 에이전트별` : "에이전트별"}
          </span>
          <PopoverRow
            color={CODEX_COLOR}
            label="Codex"
            value={agents.codexTokens}
            total={total}
          />
          <PopoverRow
            color={CLAUDE_COLOR}
            label="Claude Code"
            value={agents.claudeTokens}
            total={total}
          />
          <span className="my-2 block border-t border-white/15" />
        </>
      ) : null}
      <span className="block text-[10px] font-black tracking-[0.06em] text-white/50">
        토큰 구성
      </span>
      <PopoverRow
        color="var(--code-blue)"
        label="입력"
        value={inputTokens}
        total={total}
      />
      <PopoverRow
        color="var(--token-green)"
        label="캐시"
        value={cacheTokens}
        total={total}
      />
      <PopoverRow
        color="var(--badge-gold)"
        label="출력"
        value={outputTokens}
        total={total}
      />
      <span className="mt-2 block border-t border-white/25 pt-2 font-extrabold">
        전체{" "}
        <span className="font-mono font-black">
          {numberFormatter.format(total)}
        </span>{" "}
        토큰
        {footer ? <span className="ml-1.5 text-white/70">· {footer}</span> : null}
      </span>
    </span>
  );
}
