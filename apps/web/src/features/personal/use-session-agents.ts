"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DashboardSession,
  SessionAgent,
  SessionAgentsPage,
} from "@/lib/data/models";

const PAGE_SIZE = 100;

export function useSessionAgents(
  session: DashboardSession,
  enabled: boolean,
) {
  const initialComplete =
    session.agents.length > 0 || session.subagentCount === 0;
  const [agents, setAgents] = useState<SessionAgent[]>(session.agents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(!initialComplete);
  const initializedRef = useRef(initialComplete);
  const nextOffsetRef = useRef(session.agents.length);
  const hasMoreRef = useRef(!initialComplete);
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || !hasMoreRef.current) {
      return;
    }

    inFlightRef.current = true;
    initializedRef.current = true;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const query = new URLSearchParams({
        offset: String(nextOffsetRef.current),
        limit: String(PAGE_SIZE),
      });
      const response = await fetch(
        `/api/me/sessions/${encodeURIComponent(session.provider)}/${encodeURIComponent(session.sessionHash)}/agents?${query}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const page = (await response.json()) as SessionAgentsPage;
      setAgents((current) => {
        const existing = new Set(current.map((agent) => agent.agentKey));
        const additions = page.agents.filter(
          (agent) => !existing.has(agent.agentKey),
        );
        return [...current, ...additions];
      });
      nextOffsetRef.current = page.nextOffset ?? page.total;
      hasMoreRef.current = page.nextOffset !== null;
      setHasMore(hasMoreRef.current);
    } catch (loadError) {
      if (!controller.signal.aborted) {
        console.error("[session-agents] load failed", loadError);
        setError("서브에이전트를 불러오지 못했습니다.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }, [session.provider, session.sessionHash]);

  useEffect(() => {
    if (enabled && !initializedRef.current) {
      void loadMore();
    }
  }, [enabled, loadMore]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  return { agents, loading, error, hasMore, loadMore };
}
