import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Provider = "codex" | "claude";
type Platform = "darwin" | "linux" | "windows";

type SyncDevice = {
  device_id: string;
  device_label: string;
  platform: Platform;
};

type DailyUsage = {
  usage_date: string;
  provider: Provider;
  model: string;
  session_count: number;
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  first_used_at: string;
  last_used_at: string;
  local_updated_at: string;
};

type SyncPayload = {
  user_id?: string;
  device: SyncDevice;
  daily: DailyUsage[];
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

function isUsageDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isDailyUsage(value: unknown): value is DailyUsage {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isUsageDate(item.usage_date) &&
    isProvider(item.provider) &&
    typeof item.model === "string" &&
    item.model.length <= 200 &&
    isNonNegativeInteger(item.session_count) &&
    typeof item.local_updated_at === "string" &&
    isNonNegativeInteger(item.llm_call_count) &&
    isNonNegativeInteger(item.input_tokens) &&
    isNonNegativeInteger(item.output_tokens) &&
    isNonNegativeInteger(item.cache_tokens) &&
    isNonNegativeInteger(item.reasoning_tokens) &&
    isNonNegativeInteger(item.total_tokens) &&
    typeof item.first_used_at === "string" &&
    typeof item.last_used_at === "string";
}

function parsePayload(value: unknown): SyncPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (!isSyncDevice(payload.device)) return null;
  if (!Array.isArray(payload.daily)) return null;
  if (payload.daily.length > 5000) return null;
  if (!payload.daily.every(isDailyUsage)) return null;

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

  const dailyRows = payload.daily.map((daily) => ({
    user_id: userID,
    device_id: payload.device.device_id,
    usage_date: daily.usage_date,
    provider: daily.provider,
    model: daily.model,
    session_count: daily.session_count,
    llm_call_count: daily.llm_call_count,
    input_tokens: daily.input_tokens,
    output_tokens: daily.output_tokens,
    cache_tokens: daily.cache_tokens,
    reasoning_tokens: daily.reasoning_tokens,
    total_tokens: daily.total_tokens,
    first_used_at: daily.first_used_at,
    last_used_at: daily.last_used_at,
    local_updated_at: daily.local_updated_at,
    synced_at: syncedAt,
  }));

  if (dailyRows.length === 0) {
    return jsonResponse({ upserted: 0 });
  }

  const { error: dailyError } = await supabase
    .from("usage_daily")
    .upsert(dailyRows, { onConflict: "user_id,device_id,usage_date,provider,model" });

  if (dailyError) {
    return jsonResponse({ error: "database_error", detail: dailyError.message }, 500);
  }

  return jsonResponse({ upserted: dailyRows.length });
});
