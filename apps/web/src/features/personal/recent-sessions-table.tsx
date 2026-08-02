"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { DashboardSession, SessionAgent } from "@/lib/data/models";
import { formatTokenAmount } from "@/lib/format/tokens";
import { UsageCompositionCell } from "./usage-composition-cell";

const tooltipNumberFormatter = new Intl.NumberFormat("ko-KR");

const numberFormatter = new Intl.NumberFormat("ko-KR");

function formatDateTime(value: string | null) {
  if (!value) {
    return "아직 없음";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(/\s+/g, " ")
    .replace(/(\d{2})\. (\d{2})\./, "$1.$2.")
    .trim();
}

const hourMinuteFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatHourMinute(value: string | null) {
  if (!value) {
    return "—";
  }
  return hourMinuteFormatter.format(new Date(value));
}

function SessionTimeCell({
  startedAt,
  endedAt,
}: {
  startedAt: string;
  endedAt: string;
}) {
  return (
    <div
      className="grid min-w-0 grid-cols-[14px_minmax(0,1fr)] items-center gap-2"
      title={`${formatDateTime(startedAt)} - ${formatDateTime(endedAt)}`}
    >
      <div className="relative h-[54px]">
        <span className="absolute left-[6px] top-[9px] h-9 w-px rounded-full bg-border" />
        <span className="absolute left-[2px] top-[4px] h-2.5 w-2.5 rounded-full bg-foreground" />
        <span className="absolute bottom-[4px] left-[2px] h-2.5 w-2.5 rounded-full border-2 border-muted bg-surface" />
      </div>
      <div className="relative h-[54px] min-w-0">
        <div className="absolute left-0 right-0 top-[1px] flex h-4 min-w-0 items-center gap-2 whitespace-nowrap">
          <span className="w-10 shrink-0 text-[10px] font-black uppercase leading-none tracking-[0.08em] text-muted">
            Start
          </span>
          <span className="truncate font-mono text-[11px] font-black leading-none tracking-[0.05em] text-muted">
            {formatDateTime(startedAt)}
          </span>
        </div>
        <div className="absolute bottom-[1px] left-0 right-0 flex h-4 min-w-0 items-center gap-2 whitespace-nowrap">
          <span className="w-10 shrink-0 text-[10px] font-black uppercase leading-none tracking-[0.08em] text-muted">
            End
          </span>
          <span className="truncate font-mono text-[11px] font-black leading-none tracking-[0.05em] text-muted">
            {formatDateTime(endedAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function subagentCount(session: DashboardSession) {
  return session.agents.filter((agent) => agent.agentKey !== "main").length;
}

function PromptsCalls({
  userTurnCount,
  llmCallCount,
}: {
  userTurnCount: number;
  llmCallCount: number;
}) {
  return (
    <>
      <span className="font-black">
        {numberFormatter.format(userTurnCount)}
      </span>
      <span className="mx-1 text-border">·</span>
      <span className="font-extrabold text-muted">
        {numberFormatter.format(llmCallCount)}
      </span>
    </>
  );
}

function AgentRow({ agent }: { agent: SessionAgent }) {
  const indent = Math.min(agent.depth, 8);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const isMain = agent.agentKey === "main";
  const name = agent.labelText || (isMain ? "메인 턴" : "서브에이전트");
  const safeTotal = Math.max(agent.totalTokens, 1);
  const segments = [
    { label: "입력", value: agent.inputTokens, color: "bg-code-blue" },
    { label: "캐시", value: agent.cacheTokens, color: "bg-token-green" },
    { label: "출력", value: agent.outputTokens, color: "bg-badge-gold" },
  ];
  const flipX =
    cursor !== null && cursor.x + 14 + 260 > window.innerWidth;

  return (
    <tr className="bg-code-blue/[0.035]">
      <td className="border-b border-border/70 px-3 py-2.5">
        <div
          className="flex items-center gap-1.5 text-[13px] font-extrabold text-foreground/90"
          style={{ paddingLeft: `${4 + indent * 18}px` }}
        >
          <span className="shrink-0 text-border" aria-hidden="true">
            └
          </span>
          <span
            className="min-w-0 cursor-default truncate border-b border-dotted border-muted/50"
            onMouseMove={(event) =>
              setCursor({ x: event.clientX, y: event.clientY })
            }
            onMouseLeave={() => setCursor(null)}
          >
            {name}
          </span>
          {isMain ? (
            <span className="shrink-0 rounded-[5px] bg-surface-alt px-1.5 py-px text-[10px] font-black text-muted">
              main
            </span>
          ) : null}
        </div>
        {cursor ? (
          <div
            className="pointer-events-none fixed z-30 w-[260px] rounded-lg border border-border bg-foreground px-3.5 py-3 text-xs font-bold leading-6 text-white shadow-lg"
            style={{
              left: flipX ? cursor.x - 14 : cursor.x + 14,
              top: cursor.y + 16,
              transform: flipX ? "translateX(-100%)" : undefined,
            }}
          >
            <div className={`truncate text-[13px] font-black ${isMain ? "mb-2" : ""}`}>
              {name}
            </div>
            {isMain ? null : (
              <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.04em] text-token-green/80">
                {agent.labelType ? `${agent.labelType} · ` : ""}depth{" "}
                {agent.depth}
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-white/60">시간</span>
              <span className="font-mono">
                {formatHourMinute(agent.startedAt)} →{" "}
                {formatHourMinute(agent.endedAt)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-white/60">프롬프트 · 호출</span>
              <span className="font-mono">
                {agent.userTurnCount} · {agent.llmCallCount}
              </span>
            </div>
            <div className="my-2 border-t border-white/20" />
            {segments.map((segment) => (
              <div key={segment.label} className="flex justify-between gap-3">
                <span>
                  <span
                    className={`mr-1.5 inline-block size-2 rounded-[3px] align-middle ${segment.color}`}
                  />
                  {segment.label}
                </span>
                <span className="font-mono">
                  {formatTokenAmount(segment.value)} (
                  {Math.round((segment.value / safeTotal) * 100)}%)
                </span>
              </div>
            ))}
            <div className="my-2 border-t border-white/20" />
            <div className="flex justify-between gap-3">
              <span className="text-white/60">전체</span>
              <span className="font-mono">
                {tooltipNumberFormatter.format(agent.totalTokens)} 토큰
              </span>
            </div>
          </div>
        ) : null}
      </td>
      <td className="whitespace-nowrap border-b border-border/70 px-3 py-2.5 font-mono text-[11px] font-extrabold text-muted">
        {formatHourMinute(agent.startedAt)} → {formatHourMinute(agent.endedAt)}
      </td>
      <td className="whitespace-nowrap border-b border-border/70 px-3 py-2.5 text-center font-mono text-[13px]">
        <PromptsCalls
          userTurnCount={agent.userTurnCount}
          llmCallCount={agent.llmCallCount}
        />
      </td>
      <td className="border-b border-border/70 px-3 py-2.5">
        <UsageCompositionCell
          inputTokens={agent.inputTokens}
          cacheTokens={agent.cacheTokens}
          outputTokens={agent.outputTokens}
          totalTokens={agent.totalTokens}
        />
      </td>
    </tr>
  );
}

export function RecentSessionsTable({
  sessions,
}: {
  sessions: DashboardSession[];
}) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  return (
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-0 text-left text-sm">
        <colgroup>
          <col className="w-[25%]" />
          <col className="w-[25%]" />
          <col className="w-[12%]" />
          <col className="w-[38%]" />
        </colgroup>
        <thead>
          <tr className="text-xs font-extrabold uppercase text-muted">
            <th className="border-b border-border px-3 py-2">에이전트 · 기기</th>
            <th className="border-b border-border px-3 py-2">세션 시간</th>
            <th className="border-b border-border px-3 py-2 text-center">
              프롬프트 · 호출
            </th>
            <th className="border-b border-border px-3 py-2 text-right">
              총 사용량 · 구성
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const key = `${session.provider}-${session.sessionHash}`;
            const subCount = subagentCount(session);
            const expandable = subCount > 0 && session.agents.length > 1;
            const open = expandable && openKeys.has(key);
            const toggle = () =>
              setOpenKeys((prev) => {
                const next = new Set(prev);
                if (next.has(key)) {
                  next.delete(key);
                } else {
                  next.add(key);
                }
                return next;
              });

            return (
              <Fragment key={key}>
                <tr className={expandable ? "cursor-pointer" : undefined}>
                  <td
                    className="border-b border-border px-3 py-3"
                    onClick={expandable ? toggle : undefined}
                  >
                    <span className="flex items-center gap-1.5 font-black">
                      <span
                        aria-hidden="true"
                        className="flex w-[13px] shrink-0 items-center justify-center text-muted"
                      >
                        {expandable ? (
                          open ? (
                            <ChevronDown size={13} />
                          ) : (
                            <ChevronRight size={13} />
                          )
                        ) : null}
                      </span>
                      {session.providerLabel}
                    </span>
                    <span
                      className="mt-[3px] block max-w-[12rem] truncate pl-[19px] text-[11px] font-extrabold text-muted"
                      title={session.deviceLabel}
                    >
                      {session.deviceLabel}
                    </span>
                  </td>
                  <td className="border-b border-border px-3 py-3">
                    <SessionTimeCell
                      startedAt={session.startedAt}
                      endedAt={session.endedAt}
                    />
                  </td>
                  <td className="whitespace-nowrap border-b border-border px-3 py-3 text-center font-mono">
                    <PromptsCalls
                      userTurnCount={session.userTurnCount}
                      llmCallCount={session.llmCallCount}
                    />
                    {expandable ? (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={toggle}
                          className="rounded-full bg-code-blue/10 px-2 py-0.5 text-[10px] font-black text-code-blue"
                        >
                          서브 {subCount}
                        </button>
                      </div>
                    ) : null}
                  </td>
                  <td className="border-b border-border px-3 py-3">
                    <UsageCompositionCell
                      inputTokens={session.inputTokens}
                      cacheTokens={session.cacheTokens}
                      outputTokens={session.outputTokens}
                      totalTokens={session.totalTokens}
                    />
                  </td>
                </tr>
                {open
                  ? session.agents.map((agent) => (
                      <AgentRow key={`${key}-${agent.agentKey}`} agent={agent} />
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
