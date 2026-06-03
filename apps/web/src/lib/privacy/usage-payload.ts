const agentTypes = ["claude_code", "codex", "opencode"] as const;

const allowedUsageKeys = [
  "user_uuid",
  "device_uuid",
  "agent_type",
  "anonymized_session_id",
  "turn_started_at",
  "turn_completed_at",
  "timezone",
  "input_tokens",
  "output_tokens",
  "cache_creation_tokens",
  "cache_read_tokens",
  "reasoning_tokens",
  "total_tokens",
  "user_message_count",
  "assistant_message_count",
  "collector_version",
  "event_fingerprint",
] as const;

const forbiddenUsageKeys = new Set([
  "prompt",
  "response",
  "assistant_response",
  "assistantresponse",
  "cwd",
  "transcript_path",
  "transcriptpath",
  "raw_json_line",
  "rawjsonline",
  "raw_payload",
  "rawpayload",
  "raw_log",
  "rawlog",
  "file_path",
  "filepath",
  "path",
  "project_name",
  "projectname",
  "repository_name",
  "repositoryname",
  "repo_name",
  "reponame",
  "git_branch",
  "gitbranch",
  "git_commit",
  "gitcommit",
  "email",
  "api_key",
  "apikey",
  "access_token",
  "accesstoken",
  "oauth_token",
  "oauthtoken",
  "tool_input",
  "toolinput",
  "tool_output",
  "tooloutput",
]);

const allowedUsageKeySet = new Set<string>(allowedUsageKeys);

export type AgentType = (typeof agentTypes)[number];

export type SafeUsageEvent = {
  user_uuid: string;
  device_uuid: string;
  agent_type: AgentType;
  anonymized_session_id: string;
  turn_started_at: string;
  turn_completed_at: string;
  timezone: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  user_message_count: number;
  assistant_message_count: number;
  collector_version: string;
  event_fingerprint: string;
};

export type UsagePayloadValidation =
  | { ok: true; event: SafeUsageEvent }
  | {
      ok: false;
      errorType:
        | "invalid_json"
        | "forbidden_field"
        | "unknown_field"
        | "invalid_field";
      safeMessage: string;
    };

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[-\s]/g, "_");
}

function findForbiddenKey(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findForbiddenKey(item);

      if (nested) {
        return nested;
      }
    }

    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = normalizeKey(key);

    if (forbiddenUsageKeys.has(normalized)) {
      return key;
    }

    const nested = findForbiddenKey(nestedValue);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(key);
  }

  return value;
}

function readDateString(record: Record<string, unknown>, key: string) {
  const value = readString(record, key);

  if (Number.isNaN(Date.parse(value))) {
    throw new Error(key);
  }

  return value;
}

function readNonNegativeInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(key);
  }

  return value;
}

function readAgentType(record: Record<string, unknown>) {
  const value = record.agent_type;

  if (agentTypes.includes(value as AgentType)) {
    return value as AgentType;
  }

  throw new Error("agent_type");
}

export function validateUsagePayload(
  payload: unknown,
): UsagePayloadValidation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      errorType: "invalid_json",
      safeMessage: "Expected a JSON object usage payload.",
    };
  }

  const forbiddenKey = findForbiddenKey(payload);

  if (forbiddenKey) {
    return {
      ok: false,
      errorType: "forbidden_field",
      safeMessage: `Forbidden field rejected: ${forbiddenKey}`,
    };
  }

  const record = payload as Record<string, unknown>;
  const unknownKey = Object.keys(record).find(
    (key) => !allowedUsageKeySet.has(key),
  );

  if (unknownKey) {
    return {
      ok: false,
      errorType: "unknown_field",
      safeMessage: `Unknown field rejected: ${unknownKey}`,
    };
  }

  try {
    return {
      ok: true,
      event: {
        user_uuid: readString(record, "user_uuid"),
        device_uuid: readString(record, "device_uuid"),
        agent_type: readAgentType(record),
        anonymized_session_id: readString(record, "anonymized_session_id"),
        turn_started_at: readDateString(record, "turn_started_at"),
        turn_completed_at: readDateString(record, "turn_completed_at"),
        timezone: readString(record, "timezone"),
        input_tokens: readNonNegativeInteger(record, "input_tokens"),
        output_tokens: readNonNegativeInteger(record, "output_tokens"),
        cache_creation_tokens: readNonNegativeInteger(
          record,
          "cache_creation_tokens",
        ),
        cache_read_tokens: readNonNegativeInteger(record, "cache_read_tokens"),
        reasoning_tokens: readNonNegativeInteger(record, "reasoning_tokens"),
        total_tokens: readNonNegativeInteger(record, "total_tokens"),
        user_message_count: readNonNegativeInteger(
          record,
          "user_message_count",
        ),
        assistant_message_count: readNonNegativeInteger(
          record,
          "assistant_message_count",
        ),
        collector_version: readString(record, "collector_version"),
        event_fingerprint: readString(record, "event_fingerprint"),
      },
    };
  } catch (error) {
    return {
      ok: false,
      errorType: "invalid_field",
      safeMessage:
        error instanceof Error
          ? `Invalid field rejected: ${error.message}`
          : "Invalid field rejected.",
    };
  }
}
