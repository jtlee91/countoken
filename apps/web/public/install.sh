#!/usr/bin/env bash
# Token Plane local agent installer.
# Usage: curl -fsSL https://<site>/install.sh | bash
set -euo pipefail

REPO="jtlee91/agent-token-plane"
STATE_DIR="${HOME}/.countoken"
BIN_DIR="${STATE_DIR}/bin"
HOOKS_DIR="${STATE_DIR}/hooks"
BIN="${BIN_DIR}/token-agent"
HOOK_SCRIPT="${HOOKS_DIR}/inspect-sync.sh"

log() { printf '[token-plane] %s\n' "$1"; }

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH=amd64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *)
    log "unsupported architecture: $ARCH"
    exit 1
    ;;
esac
case "$OS" in
  darwin | linux) ;;
  *)
    log "unsupported OS: $OS"
    exit 1
    ;;
esac

mkdir -p "$BIN_DIR" "$HOOKS_DIR"

URL="https://github.com/${REPO}/releases/latest/download/token-agent-${OS}-${ARCH}"
log "downloading token-agent (${OS}-${ARCH})"
curl -fsSL -o "${BIN}.tmp" "$URL"
mv "${BIN}.tmp" "$BIN"
chmod +x "$BIN"
xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true

log "installing hook script"
cat > "$HOOK_SCRIPT" <<'HOOK_EOF'
#!/usr/bin/env bash
set -u
STATE_DIR="${HOME}/.countoken"
BIN="${STATE_DIR}/bin/token-agent"
LOG="${STATE_DIR}/hooks.log"

now_kst() {
  local offset
  offset="$(TZ=Asia/Seoul date +%z)"
  printf '%s%s:%s' "$(TZ=Asia/Seoul date +%Y-%m-%dT%H:%M:%S)" "${offset%??}" "${offset#???}"
}

mkdir -p "${STATE_DIR}"
{
  printf '[%s] inspect start\n' "$(now_kst)"

  "${BIN}" inspect \
    --state-dir "${STATE_DIR}" \
    --quiet
  status=$?

  printf '[%s] inspect exit=%s\n' "$(now_kst)" "${status}"

  if [ "${status}" -eq 0 ]; then
    printf '[%s] sync start\n' "$(now_kst)"

    "${BIN}" sync \
      --state-dir "${STATE_DIR}" \
      --quiet
    sync_status=$?

    printf '[%s] sync exit=%s\n' "$(now_kst)" "${sync_status}"
  else
    printf '[%s] sync skipped inspect_exit=%s\n' "$(now_kst)" "${status}"
  fi
} >>"${LOG}" 2>&1

exit 0
HOOK_EOF
chmod +x "$HOOK_SCRIPT"

# ----- Claude Code: register a Stop hook in ~/.claude/settings.json -----
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$CLAUDE_SETTINGS" "$HOOK_SCRIPT" <<'PY'
import json
import os
import sys

path, hook = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)

stop = data.setdefault("hooks", {}).setdefault("Stop", [])
already = any(
    h.get("command") == hook
    for group in stop
    for h in group.get("hooks", [])
)
if already:
    print("[token-plane] claude code: hook already configured")
else:
    stop.append({
        "hooks": [{
            "type": "command",
            "command": hook,
            "timeout": 10,
            "statusMessage": "Updating local token usage",
        }]
    })
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("[token-plane] claude code: hook configured")
PY
else
  log "claude code: python3 not found, skipped (add the Stop hook to ~/.claude/settings.json manually)"
fi

# ----- Codex: register a Stop hook in ~/.codex/config.toml -----
CODEX_CONFIG="${HOME}/.codex/config.toml"
if [ -f "$CODEX_CONFIG" ] && grep -qF "$HOOK_SCRIPT" "$CODEX_CONFIG"; then
  log "codex: hook already configured"
else
  mkdir -p "${HOME}/.codex"
  cat >> "$CODEX_CONFIG" <<TOML_EOF

[[hooks.Stop]]
matcher = ""

[[hooks.Stop.hooks]]
type = "command"
command = "${HOOK_SCRIPT}"
async = false
timeoutSec = 10
statusMessage = "Updating local token usage"
TOML_EOF
  log "codex: hook configured (codex may ask to trust the hook on first run)"
fi

log "install complete"
log "next step: run '${BIN} login' and finish Google login in the browser"
