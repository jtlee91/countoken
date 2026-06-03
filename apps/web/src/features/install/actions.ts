"use server";

import { randomBytes } from "node:crypto";

import {
  getServerSupabaseEnv,
  getSiteUrl,
  hasIngestPersistenceEnv,
} from "@/lib/env";
import { hashIngestCredential } from "@/lib/ingest/credential-hashing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SupportedInstallAgent = "claude_code" | "codex";

export type InstallPrompt = {
  agentType: SupportedInstallAgent;
  label: string;
  pasteLabel: string;
  prompt: string;
};

export type MacbookInstallActionResult =
  | {
      ok: true;
      deviceUuid: string;
      agentTypes: SupportedInstallAgent[];
      endpoint: string;
      configJson: string;
      installPrompts: InstallPrompt[];
    }
  | {
      ok: false;
      errorType:
        | "login_required"
        | "ingest_not_configured"
        | "device_create_failed"
        | "installation_create_failed";
      safeMessage: string;
    };

type DeviceInsertRow = {
  id: string;
};

function oneTimeSecret(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function normalizeDeviceLabel(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "MacBook";
  }

  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 60) : "MacBook";
}

function endpointUrl() {
  return `${getSiteUrl().replace(/\/$/, "")}/api/ingest/usage`;
}

function buildConfigJson(input: {
  endpoint: string;
  userUuid: string;
  deviceUuid: string;
  ingestKey: string;
  localSecret: string;
}) {
  return JSON.stringify(
    {
      endpoint: input.endpoint,
      user_uuid: input.userUuid,
      device_uuid: input.deviceUuid,
      ingest_key: input.ingestKey,
      local_secret: input.localSecret,
      timezone: "UTC",
    },
    null,
    2,
  );
}

function buildInstallPrompt(input: {
  targetAgentLabel: string;
  configJson: string;
}) {
  return `Install Token Plane on this MacBook for both Claude Code and Codex.

Use the repository already open in this session if it is token-plane. If it is not available, clone https://github.com/jtlee91/token-plane into a temporary working directory and use that checkout.

Hard privacy rules:
- Never store raw transcripts, transcript paths, cwd, project paths, prompts, responses, raw JSON lines, git metadata, API keys, or OAuth tokens in Token Plane config, SQLite, logs, hook configs, or server payloads.
- Only write the Token Plane credential to ~/.token-plane/config.json with mode 600.
- Preserve existing Claude Code and Codex user configuration. Merge hook entries; do not overwrite unrelated settings.

Credential/config to install:
\`\`\`json
${input.configJson}
\`\`\`

Do the install work:
1. Create ~/.token-plane and write the JSON above to ~/.token-plane/config.json. Run chmod 700 ~/.token-plane and chmod 600 ~/.token-plane/config.json.
2. Build and install the tokenplane CLI from the repo with Go:
   mkdir -p "$HOME/.token-plane/bin"
   GOCACHE="/private/tmp/token_plane_gocache" GOMODCACHE="/private/tmp/token_plane_gomodcache" go build -o "$HOME/.token-plane/bin/tokenplane" ./collector/portable/cmd/tokenplane
3. Install two fail-open shims:
   - ~/.token-plane/token-plane-claude-code.sh sets TOKEN_PLANE_BIN="$HOME/.token-plane/bin/tokenplane", calls "$TOKEN_PLANE_BIN" collect --agent claude_code, then "$TOKEN_PLANE_BIN" sync, redirects collector/sync output away from agent output, and exits 0.
   - ~/.token-plane/token-plane-codex.sh sets TOKEN_PLANE_BIN="$HOME/.token-plane/bin/tokenplane", calls "$TOKEN_PLANE_BIN" collect --agent codex, then "$TOKEN_PLANE_BIN" sync, redirects collector/sync output away from agent output, and exits 0.
   Both shims must read hook JSON from stdin naturally and must not write stdin or transcript_path to disk.
4. Merge Claude Code hooks into ~/.claude/settings.json. Preserve existing JSON. Add command hooks under the top-level "hooks" object for both SessionStart and Stop with matcher "*" that run ~/.token-plane/token-plane-claude-code.sh. Use this shape when adding new entries:
   {"hooks":{"SessionStart":[{"matcher":"*","hooks":[{"type":"command","command":"$HOME/.token-plane/token-plane-claude-code.sh"}]}],"Stop":[{"matcher":"*","hooks":[{"type":"command","command":"$HOME/.token-plane/token-plane-claude-code.sh"}]}]}}
5. Merge Codex hooks into \${CODEX_HOME:-~/.codex}/hooks.json. Preserve existing JSON. Add command hooks for both SessionStart and Stop that run ~/.token-plane/token-plane-codex.sh. Use this shape when adding new entries:
   {"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"sh -c '$HOME/.token-plane/token-plane-codex.sh'","timeout":10}]}],"Stop":[{"hooks":[{"type":"command","command":"sh -c '$HOME/.token-plane/token-plane-codex.sh'","timeout":10}]}]}}
   Do not duplicate an existing Token Plane hook if one is already present.
6. Run "$HOME/.token-plane/bin/tokenplane" doctor --safe and report only that safe summary. Do not print the ingest key, local secret, transcript paths, cwd, project paths, or full doctor output after config creation.

This prompt was generated for ${input.targetAgentLabel}, but the install must configure both Claude Code and Codex on the same MacBook.`;
}

async function recordInstallAudit(input: {
  userId: string;
  deviceId?: string | null;
  agentType?: SupportedInstallAgent | null;
  step: string;
  result: string;
}) {
  try {
    const supabase = createAdminClient();
    await supabase.from("install_audits").insert({
      user_id: input.userId,
      device_id: input.deviceId ?? null,
      agent_type: input.agentType ?? null,
      step: input.step,
      result: input.result,
    });
  } catch {
    // Audit writes must not expose secrets or block credential generation.
  }
}

export async function createMacbookInstallAction(
  formData: FormData,
): Promise<MacbookInstallActionResult> {
  if (!hasIngestPersistenceEnv()) {
    return {
      ok: false,
      errorType: "ingest_not_configured",
      safeMessage:
        "Server ingest persistence is not configured for credential issuance.",
    };
  }

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return {
      ok: false,
      errorType: "login_required",
      safeMessage: "Login is required to create a MacBook install credential.",
    };
  }

  const ingestKey = oneTimeSecret("tp_ingest");
  const localSecret = oneTimeSecret("tp_local");
  const { ingestCredentialPepper } = getServerSupabaseEnv();
  const supabase = createAdminClient();
  const deviceLabel = normalizeDeviceLabel(formData.get("device_label"));

  const { data: device, error: deviceError } = await supabase
    .from("devices")
    .insert({
      user_id: user.id,
      device_label: deviceLabel,
      ingest_credential_hash: hashIngestCredential(
        ingestKey,
        ingestCredentialPepper,
      ),
      revoked: false,
    })
    .select("id")
    .single<DeviceInsertRow>();

  if (deviceError || !device) {
    await recordInstallAudit({
      userId: user.id,
      step: "macbook_device_create",
      result: "error",
    });

    return {
      ok: false,
      errorType: "device_create_failed",
      safeMessage: "MacBook device could not be created.",
    };
  }

  const agentTypes: SupportedInstallAgent[] = ["claude_code", "codex"];
  const { error: installationError } = await supabase
    .from("agent_installations")
    .insert(
      agentTypes.map((agentType) => ({
        user_id: user.id,
        device_id: device.id,
        agent_type: agentType,
        support_level: "official",
        status: "pending",
      })),
    );

  if (installationError) {
    await recordInstallAudit({
      userId: user.id,
      deviceId: device.id,
      step: "dual_agent_installation_create",
      result: "error",
    });

    return {
      ok: false,
      errorType: "installation_create_failed",
      safeMessage: "Agent installation rows could not be created.",
    };
  }

  await Promise.all(
    agentTypes.map((agentType) =>
      recordInstallAudit({
        userId: user.id,
        deviceId: device.id,
        agentType,
        step: "macbook_install_created",
        result: "success",
      }),
    ),
  );

  const endpoint = endpointUrl();
  const configJson = buildConfigJson({
    endpoint,
    userUuid: user.id,
    deviceUuid: device.id,
    ingestKey,
    localSecret,
  });

  return {
    ok: true,
    deviceUuid: device.id,
    agentTypes,
    endpoint,
    configJson,
    installPrompts: [
      {
        agentType: "claude_code",
        label: "Claude Code",
        pasteLabel: "Claude Code에 붙여넣기",
        prompt: buildInstallPrompt({
          targetAgentLabel: "Claude Code",
          configJson,
        }),
      },
      {
        agentType: "codex",
        label: "Codex",
        pasteLabel: "Codex에 붙여넣기",
        prompt: buildInstallPrompt({
          targetAgentLabel: "Codex",
          configJson,
        }),
      },
    ],
  };
}
