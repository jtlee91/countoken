import { type NextRequest, NextResponse } from "next/server";

import type { SessionAgentsPage } from "@/lib/data/models";
import {
  toSessionAgentsPage,
  type UsageSessionAgentRow,
} from "@/lib/data/usage-session-aggregates";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const SESSION_HASH_PATTERN = /^[a-f0-9]{64}$/;
const AGENT_COLUMNS = [
  "agent_key",
  "parent_agent_key",
  "depth",
  "label_type",
  "label_text",
  "input_tokens",
  "output_tokens",
  "cache_tokens",
  "llm_call_count",
  "user_turn_count",
  "started_at",
  "ended_at",
].join(",");

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === null || !/^\d+$/.test(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ provider: string; sessionHash: string }>;
  },
) {
  if (!hasPublicSupabaseEnv()) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const { provider, sessionHash } = await params;
  if (
    (provider !== "codex" && provider !== "claude") ||
    !SESSION_HASH_PATTERN.test(sessionHash)
  ) {
    return NextResponse.json({ error: "invalid_session" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (typeof userId !== "string" || userId.length === 0) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const offset = boundedInteger(
    request.nextUrl.searchParams.get("offset"),
    0,
    0,
    1_000_000,
  );
  const limit = boundedInteger(
    request.nextUrl.searchParams.get("limit"),
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );

  const { data, count, error } = await supabase
    .from("usage_session_agents")
    .select(AGENT_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("session_hash", sessionHash)
    .or(
      "agent_key.eq.main,llm_call_count.gt.0,input_tokens.gt.0,output_tokens.gt.0,cache_tokens.gt.0",
    )
    .order("depth", { ascending: true })
    .order("started_at", { ascending: true })
    .order("agent_key", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[session-agents] query failed", {
      provider,
      sessionHash,
      error: error.message,
    });
    return NextResponse.json({ error: "database_error" }, { status: 500 });
  }

  const payload: SessionAgentsPage = toSessionAgentsPage(
    (data ?? []) as unknown as UsageSessionAgentRow[],
    count,
    offset,
  );

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
