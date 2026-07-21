# Countoken local agent installer for Windows.
# Usage: irm https://<site>/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Repo = 'jtlee91/countoken'
$StateDir = Join-Path $env:USERPROFILE '.countoken'
$BinDir = Join-Path $StateDir 'bin'
$HooksDir = Join-Path $StateDir 'hooks'
$Bin = Join-Path $BinDir 'token-agent.exe'
$HookScript = Join-Path $HooksDir 'inspect-sync.ps1'

function Write-Log([string]$Message) {
    Write-Host "[token-plane] $Message"
}

switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { $Arch = 'amd64' }
    'ARM64' { $Arch = 'arm64' }
    default {
        Write-Log "unsupported architecture: $env:PROCESSOR_ARCHITECTURE"
        exit 1
    }
}

New-Item -ItemType Directory -Force -Path $BinDir, $HooksDir | Out-Null

$Url = "https://github.com/$Repo/releases/latest/download/token-agent-windows-$Arch.exe"
Write-Log "downloading token-agent (windows-$Arch)"
$Tmp = "$Bin.tmp"
Invoke-WebRequest -Uri $Url -OutFile $Tmp -UseBasicParsing
Move-Item -Force $Tmp $Bin

Write-Log 'installing hook script'
$HookBody = @'
# Countoken Stop hook: refresh local usage, then sync when inspect succeeds.
$ErrorActionPreference = 'Continue'
$StateDir = Join-Path $env:USERPROFILE '.countoken'
$Bin = Join-Path $StateDir 'bin\token-agent.exe'
$LogFile = Join-Path $StateDir 'hooks.log'

function Get-KstTimestamp {
    $kst = [TimeZoneInfo]::FindSystemTimeZoneById('Korea Standard Time')
    $now = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $kst)
    return $now.ToString('yyyy-MM-ddTHH:mm:ss') + '+09:00'
}

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

Add-Content -Path $LogFile -Value "[$(Get-KstTimestamp)] inspect start"
& $Bin inspect --state-dir $StateDir --quiet *>> $LogFile
$status = $LASTEXITCODE
Add-Content -Path $LogFile -Value "[$(Get-KstTimestamp)] inspect exit=$status"

if ($status -eq 0) {
    Add-Content -Path $LogFile -Value "[$(Get-KstTimestamp)] sync start"
    & $Bin sync --state-dir $StateDir --quiet *>> $LogFile
    Add-Content -Path $LogFile -Value "[$(Get-KstTimestamp)] sync exit=$LASTEXITCODE"
} else {
    Add-Content -Path $LogFile -Value "[$(Get-KstTimestamp)] sync skipped inspect_exit=$status"
}

exit 0
'@
Set-Content -Path $HookScript -Value $HookBody -Encoding utf8

$HookCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$HookScript`""

# ----- Claude Code: register a Stop hook in ~/.claude/settings.json -----
$ClaudeSettings = Join-Path $env:USERPROFILE '.claude\settings.json'
$settings = $null
if (Test-Path $ClaudeSettings) {
    $settings = Get-Content -Raw $ClaudeSettings | ConvertFrom-Json
}
if ($null -eq $settings) { $settings = [pscustomobject]@{} }

if (-not $settings.PSObject.Properties['hooks']) {
    $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
}
if (-not $settings.hooks.PSObject.Properties['Stop']) {
    $settings.hooks | Add-Member -NotePropertyName Stop -NotePropertyValue @()
}

$already = $false
foreach ($group in @($settings.hooks.Stop)) {
    foreach ($h in @($group.hooks)) {
        if ($h.command -eq $HookCommand) { $already = $true }
    }
}
if ($already) {
    Write-Log 'claude code: hook already configured'
} else {
    $entry = [pscustomobject]@{
        hooks = @([pscustomobject]@{
            type          = 'command'
            command       = $HookCommand
            timeout       = 10
            statusMessage = 'Updating local token usage'
        })
    }
    $settings.hooks.Stop = @($settings.hooks.Stop) + $entry
    New-Item -ItemType Directory -Force -Path (Split-Path $ClaudeSettings) | Out-Null
    $settings | ConvertTo-Json -Depth 32 | Set-Content -Path $ClaudeSettings -Encoding utf8
    Write-Log 'claude code: hook configured'
}

# ----- Codex: register a Stop hook in ~/.codex/config.toml -----
$CodexConfig = Join-Path $env:USERPROFILE '.codex\config.toml'
if ((Test-Path $CodexConfig) -and (Select-String -Path $CodexConfig -SimpleMatch 'inspect-sync.ps1' -Quiet)) {
    Write-Log 'codex: hook already configured'
} else {
    New-Item -ItemType Directory -Force -Path (Split-Path $CodexConfig) | Out-Null
    # TOML basic strings treat backslash as an escape; escape them in the path.
    $TomlCommand = $HookCommand.Replace('\', '\\').Replace('"', '\"')
    $TomlBlock = @"

[[hooks.Stop]]
matcher = ""

[[hooks.Stop.hooks]]
type = "command"
command = "$TomlCommand"
async = false
timeoutSec = 10
statusMessage = "Updating local token usage"
"@
    Add-Content -Path $CodexConfig -Value $TomlBlock
    Write-Log 'codex: hook configured (codex may ask to trust the hook on first run)'
}

Write-Log 'install complete'
Write-Log "next step: run '$Bin login' and finish Google login in the browser"
