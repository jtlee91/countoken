import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Provider = "codex" | "claude";
type Platform = "darwin" | "linux" | "windows";

type SyncDevice = {
  device_id: string;
  device_label: string;
  platform: Platform;
};

type UsageSession = {
  session_hash: string;
  provider: Provider;
  started_at: string;
  ended_at: string;
  user_turn_count: number;
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  local_updated_at: string;
};

type SyncPayload = {
  user_id?: string;
  device: SyncDevice;
  sessions: UsageSession[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Connection": "keep-alive",
    },
  });
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isProvider(value: unknown): value is Provider {
  return value === "codex" || value === "claude";
}

function isPlatform(value: unknown): value is Platform {
  return value === "darwin" || value === "linux" || value === "windows";
}

function isUUID(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSyncDevice(value: unknown): value is SyncDevice {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isUUID(item.device_id) &&
    typeof item.device_label === "string" &&
    item.device_label.trim().length > 0 &&
    item.device_label.length <= 120 &&
    isPlatform(item.platform);
}

function isUsageSession(value: unknown): value is UsageSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.session_hash === "string" &&
    item.session_hash.length > 0 &&
    isProvider(item.provider) &&
    typeof item.started_at === "string" &&
    typeof item.ended_at === "string" &&
    typeof item.local_updated_at === "string" &&
    isNonNegativeInteger(item.user_turn_count) &&
    isNonNegativeInteger(item.llm_call_count) &&
    isNonNegativeInteger(item.input_tokens) &&
    isNonNegativeInteger(item.output_tokens) &&
    isNonNegativeInteger(item.cache_tokens) &&
    isNonNegativeInteger(item.reasoning_tokens) &&
    isNonNegativeInteger(item.total_tokens);
}

function parsePayload(value: unknown): SyncPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (!isSyncDevice(payload.device)) return null;
  if (!Array.isArray(payload.sessions)) return null;
  if (payload.sessions.length > 500) return null;
  if (!payload.sessions.every(isUsageSession)) return null;

  return payload as SyncPayload;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch (_error) {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return jsonResponse({ error: "invalid_payload" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !authorization) {
    return jsonResponse({ error: "server_not_configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const userID = userData.user.id;
  const syncedAt = new Date().toISOString();
  const { error: deviceError } = await supabase
    .from("usage_devices")
    .upsert({
      user_id: userID,
      device_id: payload.device.device_id,
      device_label: payload.device.device_label.trim(),
      platform: payload.device.platform,
      last_seen_at: syncedAt,
    }, { onConflict: "user_id,device_id" });

  if (deviceError) {
    return jsonResponse({ error: "database_error", detail: deviceError.message }, 500);
  }

  const sessionRows = payload.sessions.map((session) => ({
    user_id: userID,
    device_id: payload.device.device_id,
    session_hash: session.session_hash,
    provider: session.provider,
    started_at: session.started_at,
    ended_at: session.ended_at,
    user_turn_count: session.user_turn_count,
    llm_call_count: session.llm_call_count,
    input_tokens: session.input_tokens,
    output_tokens: session.output_tokens,
    cache_tokens: session.cache_tokens,
    reasoning_tokens: session.reasoning_tokens,
    total_tokens: session.total_tokens,
    local_updated_at: session.local_updated_at,
    synced_at: syncedAt,
  }));

  if (sessionRows.length === 0) {
    return jsonResponse({ upserted: 0 });
  }

  const { error: sessionError } = await supabase
    .from("usage_sessions")
    .upsert(sessionRows, { onConflict: "user_id,provider,session_hash" });

  if (sessionError) {
    return jsonResponse({ error: "database_error", detail: sessionError.message }, 500);
  }

  return jsonResponse({ upserted: sessionRows.length });
});
