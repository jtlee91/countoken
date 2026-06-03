import "server-only";

import {
  hasIngestPersistenceEnv,
  hasPublicSupabaseEnv,
  hasServerSupabaseEnv,
} from "@/lib/env";
import {
  hashIngestCredential,
  safeHashEquals,
} from "@/lib/ingest/credential-hashing";
import type { SafeUsageEvent } from "@/lib/privacy/usage-payload";
import { createAdminClient } from "@/lib/supabase/admin";

export type VerifiedDeviceContext =
  | {
      mode: "dry-run";
      userId: string;
      deviceId: string;
      agentInstallationId: null;
    }
  | {
      mode: "supabase";
      userId: string;
      deviceId: string;
      agentInstallationId: string | null;
    };

export type DeviceCredentialVerification =
  | { ok: true; context: VerifiedDeviceContext }
  | {
      ok: false;
      status: 401 | 503;
      errorType: "unauthorized" | "ingest_not_configured";
      safeMessage: string;
    };

type DeviceRow = {
  id: string;
  user_id: string;
  ingest_credential_hash: string;
  revoked: boolean;
};

type AgentInstallationRow = {
  id: string;
};

function ingestEnvIsPartiallyConfigured() {
  return (
    hasPublicSupabaseEnv() ||
    hasServerSupabaseEnv() ||
    Boolean(process.env.INGEST_CREDENTIAL_PEPPER)
  );
}

export async function verifyDeviceCredential(
  event: SafeUsageEvent,
  credential: string,
): Promise<DeviceCredentialVerification> {
  if (!hasIngestPersistenceEnv()) {
    if (ingestEnvIsPartiallyConfigured()) {
      return {
        ok: false,
        status: 503,
        errorType: "ingest_not_configured",
        safeMessage:
          "Ingest persistence env is incomplete. Usage was not stored.",
      };
    }

    return {
      ok: true,
      context: {
        mode: "dry-run",
        userId: event.user_uuid,
        deviceId: event.device_uuid,
        agentInstallationId: null,
      },
    };
  }

  const supabase = createAdminClient();
  const { data: device, error } = await supabase
    .from("devices")
    .select("id, user_id, ingest_credential_hash, revoked")
    .eq("id", event.device_uuid)
    .eq("user_id", event.user_uuid)
    .maybeSingle<DeviceRow>();

  if (error || !device || device.revoked) {
    return {
      ok: false,
      status: 401,
      errorType: "unauthorized",
      safeMessage: "Missing or invalid ingest credential.",
    };
  }

  const expectedHash = hashIngestCredential(
    credential,
    process.env.INGEST_CREDENTIAL_PEPPER ?? "",
  );

  if (!safeHashEquals(expectedHash, device.ingest_credential_hash)) {
    return {
      ok: false,
      status: 401,
      errorType: "unauthorized",
      safeMessage: "Missing or invalid ingest credential.",
    };
  }

  const { data: installation } = await supabase
    .from("agent_installations")
    .select("id")
    .eq("user_id", event.user_uuid)
    .eq("device_id", event.device_uuid)
    .eq("agent_type", event.agent_type)
    .maybeSingle<AgentInstallationRow>();

  return {
    ok: true,
    context: {
      mode: "supabase",
      userId: device.user_id,
      deviceId: device.id,
      agentInstallationId: installation?.id ?? null,
    },
  };
}
