"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { DashboardSession } from "@/lib/data/models";
import { formatTokenAmount } from "@/lib/format/tokens";
import { UsageBreakdownPopover } from "./usage-breakdown-popover";

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const hourMinuteFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatTimestamp(value: string) {
  return timeFormatter
    .format(new Date(value))
    .replace(/\s+/g, " ")
    .replace(/(\d{2})\. (\d{2})\./, "$1.$2.")
    .trim();
}

function formatHourMinute(value: string | null) {
  if (!value) {
    return "—";
  }
  return hourMinuteFormatter.format(new Date(value));
}

function formatDuration(startedAt: string, endedAt: string) {
  const minutes = Math.max(
    0,
    Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000,
    ),
  );

  if (minutes < 60) {
    return `${minutes}분`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

function compositionSegments(session: DashboardSession) {
  const total = Math.max(1, session.totalTokens);
  const pct = (value: number) => Math.round((value / total) * 100);

  return [
    { className: "bg-code-blue", width: pct(session.inputTokens) },
    { className: "bg-token-green", width: pct(session.cacheTokens) },
    { className: "bg-badge-gold", width: pct(session.outputTokens) },
  ].filter((segment) => segment.width > 0);
}

// 모바일 전용 — 한 줄 요약을 탭하면 세션 상세가 펼쳐진다
export function RecentSessionsAccordion({
  sessions,
}: {
  sessions: DashboardSession[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [barOpen, setBarOpen] = useState(false);
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  return (
    <div className="sm:hidden">
      {sessions.map((session) => {
        const key = `${session.provider}-${session.sessionHash}`;
        const open = openKey === key;

        return (
          <div key={key} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => {
                setOpenKey(open ? null : key);
                setBarOpen(false);
                setOpenAgent(null);
              }}
              aria-expanded={open}
              className="flex min-h-12 w-full items-center gap-2 py-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-black">
                {session.providerLabel}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-extrabold text-muted">
                {formatTimestamp(session.startedAt)}
              </span>
              <span className="shrink-0 font-mono text-[13px] font-black">
                {formatTokenAmount(session.totalTokens)}
              </span>
              {open ? (
                <ChevronDown
                  size={14}
                  className="shrink-0 text-muted"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  size={14}
                  className="shrink-0 text-muted"
                  aria-hidden="true"
                />
              )}
            </button>
            {open ? (
              <div className="mb-3 rounded-lg border border-border bg-background p-3">
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={barOpen}
                    onClick={() => setBarOpen((value) => !value)}
                    className={`flex h-2.5 w-full overflow-hidden rounded-full ${
                      barOpen ? "ring-2 ring-token-green/45" : ""
                    }`}
                  >
                    {compositionSegments(session).map((segment) => (
                      <span
                        key={segment.className}
                        className={`${segment.className} h-full`}
                        style={{ width: `${segment.width}%` }}
                      />
                    ))}
                  </button>
                  {barOpen ? (
                    <div className="absolute left-0 top-full z-20 mt-2.5 w-[280px] max-w-full">
                      <UsageBreakdownPopover
                        inputTokens={session.inputTokens}
                        cacheTokens={session.cacheTokens}
                        outputTokens={session.outputTokens}
                        footer={`프롬프트 ${session.userTurnCount.toLocaleString(
                          "ko-KR",
                        )} · 호출 ${session.llmCallCount.toLocaleString(
                          "ko-KR",
                        )}`}
                      />
                    </div>
                  ) : null}
                </div>
                <dl className="mt-2.5 space-y-1.5 text-xs font-bold text-muted">
                  <div className="flex items-center justify-between gap-3">
                    <dt>세션 시간</dt>
                    <dd className="font-mono font-extrabold text-foreground">
                      {hourMinuteFormatter.format(new Date(session.startedAt))}{" "}
                      → {hourMinuteFormatter.format(new Date(session.endedAt))}{" "}
                      ({formatDuration(session.startedAt, session.endedAt)})
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>기기</dt>
                    <dd className="truncate font-extrabold text-foreground">
                      {session.deviceLabel}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt>프롬프트 · LLM 호출</dt>
                    <dd className="font-mono font-extrabold text-foreground">
                      {session.userTurnCount.toLocaleString("ko-KR")} ·{" "}
                      {session.llmCallCount.toLocaleString("ko-KR")}
                    </dd>
                  </div>
                </dl>
                {session.agents.filter((agent) => agent.agentKey !== "main")
                  .length > 0 ? (
                  <div className="mt-3 border-t border-border pt-2.5">
                    <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.04em] text-muted">
                      서브에이전트{" "}
                      {
                        session.agents.filter(
                          (agent) => agent.agentKey !== "main",
                        ).length
                      }
                    </p>
                    <ul className="space-y-1.5">
                      {session.agents.map((agent) => {
                        const isMain = agent.agentKey === "main";
                        const name =
                          agent.labelText ||
                          (isMain ? "메인 턴" : "서브에이전트");
                        const agentId = `${key}::${agent.agentKey}`;
                        const popOpen = openAgent === agentId;
                        const safeTotal = Math.max(agent.totalTokens, 1);
                        const segments = [
                          {
                            label: "입력",
                            value: agent.inputTokens,
                            color: "bg-code-blue",
                          },
                          {
                            label: "캐시",
                            value: agent.cacheTokens,
                            color: "bg-token-green",
                          },
                          {
                            label: "출력",
                            value: agent.outputTokens,
                            color: "bg-badge-gold",
                          },
                        ];

                        return (
                          <li
                            key={agent.agentKey}
                            className="relative flex items-center gap-2 text-xs font-bold"
                            style={{
                              paddingLeft: `${Math.min(agent.depth, 8) * 14}px`,
                            }}
                          >
                            {isMain ? (
                              <span className="min-w-0 flex-1 truncate text-foreground">
                                {name}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenAgent(popOpen ? null : agentId)
                                }
                                aria-expanded={popOpen}
                                className={`min-w-0 flex-1 truncate text-left ${
                                  popOpen ? "text-code-blue" : "text-foreground"
                                }`}
                              >
                                {name}
                              </button>
                            )}
                            <span className="shrink-0 font-mono font-black text-foreground">
                              {formatTokenAmount(agent.totalTokens)}
                            </span>

                            {popOpen ? (
                              <>
                                <button
                                  type="button"
                                  aria-label="닫기"
                                  onClick={() => setOpenAgent(null)}
                                  className="fixed inset-0 z-20 cursor-default"
                                />
                                <div className="absolute bottom-full left-1/2 z-30 mb-2.5 w-[268px] max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-xl border border-black/20 bg-foreground px-4 py-3 leading-6 text-white shadow-2xl">
                                  <div className="truncate text-[13px] font-black">
                                    {name}
                                  </div>
                                  <div className="mb-2 text-[10px] font-black uppercase tracking-[0.04em] text-token-green/80">
                                    {agent.labelType
                                      ? `${agent.labelType} · `
                                      : ""}
                                    depth {agent.depth}
                                  </div>
                                  <div className="flex justify-between gap-3 text-xs">
                                    <span className="text-white/60">시간</span>
                                    <span className="font-mono">
                                      {formatHourMinute(agent.startedAt)} →{" "}
                                      {formatHourMinute(agent.endedAt)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-3 text-xs">
                                    <span className="text-white/60">
                                      프롬프트 · 호출
                                    </span>
                                    <span className="font-mono">
                                      {agent.userTurnCount} · {agent.llmCallCount}
                                    </span>
                                  </div>
                                  <div className="my-2 border-t border-white/20" />
                                  {segments.map((segment) => (
                                    <div
                                      key={segment.label}
                                      className="flex items-center text-xs"
                                    >
                                      <span
                                        className={`mr-2 inline-block size-2 rounded-[3px] ${segment.color}`}
                                      />
                                      {segment.label}
                                      <span className="ml-auto font-mono font-black">
                                        {formatTokenAmount(segment.value)}
                                      </span>
                                      <span className="ml-2 w-9 text-right font-mono text-white/55">
                                        {Math.round(
                                          (segment.value / safeTotal) * 100,
                                        )}
                                        %
                                      </span>
                                    </div>
                                  ))}
                                  <div className="my-2 border-t border-white/20" />
                                  <div className="flex justify-between gap-3 text-xs">
                                    <span className="text-white/60">전체</span>
                                    <span className="font-mono">
                                      {agent.totalTokens.toLocaleString("ko-KR")}{" "}
                                      토큰
                                    </span>
                                  </div>
                                  <span className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r border-black/20 bg-foreground" />
                                </div>
                              </>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
