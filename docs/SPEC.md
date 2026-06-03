# Local Agent Usage Spec

This document describes the current implementation of `local-agent-usage`.
It is intended to be sufficient for another code agent to rebuild the same
local parser, SQLite state store, and Supabase sync behavior without reading the
existing source first.

## Goal

Build a local CLI named `token-agent` that reads local JSONL session files from
Codex and Claude Code, extracts token usage only, stores sanitized session
summaries and call-level usage rows in SQLite, and optionally uploads
device-level daily usage aggregates to Supabase.

The tool must not store or upload prompts, assistant outputs, raw JSONL lines,
raw local file paths, or other message content. The only session identity stored
locally is a deterministic hash of the provider-specific session ID. Session
identity is not uploaded to Supabase in the daily aggregate sync payload.

## Tech Stack

- Language: Go
- CLI package: standard library `flag`
- SQLite driver: `modernc.org/sqlite`
- Local state directory: `~/.mylocalagenttoken`
- Local database: `~/.mylocalagenttoken/usage.sqlite`
- Auth state: `~/.mylocalagenttoken/auth.json`
- Timezone for local timestamps: fixed KST, UTC+09:00
- Remote sync: Supabase Edge Function protected by Supabase Auth JWT

## CLI Commands

### `inspect`

Reads JSONL files, parses usage summaries, and updates SQLite.

Default behavior parses both providers.

```bash
token-agent inspect
```

Important flags:

```text
--provider codex|claude     parse one provider only; empty means all
--codex-sessions PATH       default ~/.codex/sessions
--claude-projects PATH      default ~/.claude/projects
--state-dir PATH            default ~/.mylocalagenttoken
--quiet                     suppress JSON output
```

Output shape when not quiet:

```json
{
  "files_scanned": 0,
  "files_parsed": 0,
  "files_reused": 0,
  "files_skipped": 0,
  "sessions_found": 0,
  "sessions": [
    {
      "provider": "codex",
      "session_hash": "hex_sha256",
      "started_at": "2026-06-03T10:00:00+09:00",
      "ended_at": "2026-06-03T10:05:00+09:00",
      "user_turn_count": 1,
      "llm_call_count": 2,
      "tokens": {
        "input": 100,
        "output": 20,
        "cache": 80,
        "reasoning": 5,
        "total": 205
      }
    }
  ]
}
```

### `login`

Default login uses Supabase Google OAuth with PKCE and a localhost callback.
The CLI opens the browser, receives the authorization code on a temporary local
HTTP server, exchanges it for Supabase access and refresh tokens, and stores the
session locally.

```bash
token-agent login
```

Important flags:

```text
--state-dir PATH        default ~/.mylocalagenttoken
--supabase-url URL      Supabase project URL, env TOKEN_AGENT_SUPABASE_URL
--anon-key KEY          Supabase anon key, env TOKEN_AGENT_SUPABASE_ANON_KEY
--sync-endpoint URL     Edge Function URL, env TOKEN_AGENT_SYNC_ENDPOINT
--provider NAME         OAuth provider, default google
--callback-address ADDR local callback listener, default 127.0.0.1:8787
--timeout DURATION      OAuth login timeout, default 5m
--no-browser            print OAuth URL without opening a browser
--email EMAIL           Supabase Auth email, env TOKEN_AGENT_EMAIL
--password VALUE        direct password; avoid for shell history
--password-env NAME     env var containing password, default TOKEN_AGENT_PASSWORD
--quiet                 suppress JSON output
```

If `--email` is provided, the CLI uses the legacy email/password login path.
This remains available only as a temporary testing fallback.

Supabase Auth redirect allowlist must include:

```text
http://127.0.0.1:8787/auth/callback
```

On success, write `auth.json` with mode `0600`.
Do not print access tokens, refresh tokens, passwords, or OAuth codes.

`auth.json` fields:

```json
{
  "supabase_url": "https://project.supabase.co",
  "anon_key": "public-anon-key",
  "sync_endpoint": "https://project.supabase.co/functions/v1/sync-usage",
  "access_token": "secret",
  "refresh_token": "secret",
  "expires_at": 1780000000,
  "user_id": "uuid"
}
```

### `sync`

Uploads only daily aggregates affected by locally changed sessions to Supabase.

```bash
token-agent sync
```

Important flags:

```text
--state-dir PATH     default ~/.mylocalagenttoken
--endpoint URL       sync endpoint URL, env TOKEN_AGENT_SYNC_ENDPOINT
--token TOKEN        bearer token override, env TOKEN_AGENT_SYNC_TOKEN
--quiet              suppress JSON output
```

Behavior:

- Open `usage.sqlite`.
- Read only rows where `sessions.need_sync = 1` to determine which sessions
  changed locally.
- If no pending rows exist, return `daily_uploaded: 0` and do not call the
  network.
- Compute affected `(provider, usage_date)` pairs from pending sessions'
  `usage_calls`.
- Recompute full-day aggregates for those affected provider/date pairs from all
  local `usage_calls`, split by `model`.
- If no `--token` is supplied, load `auth.json`.
- Refresh the access token if it is expired or will expire within five minutes.
- POST the daily aggregate rows to the sync endpoint.
- After a successful HTTP 2xx response, mark uploaded rows as synced:
  `need_sync = 0`, `synced_at = now KST`.
- If upload fails, leave `need_sync = 1` so the next sync retries.

Output shape:

```json
{
  "daily_uploaded": 3
}
```

## Local Input Paths

Codex:

```text
~/.codex/sessions
```

Claude Code:

```text
~/.claude/projects
```

The implementation walks each root recursively and parses files with extension
`.jsonl`. Missing roots are treated as empty input.

## JSONL Rules

Each line is an independent JSON document. The parser must scan line by line
with a large scanner buffer, because session files can contain long JSON lines.
Use a scanner buffer ceiling of at least `64 * 1024 * 1024`.

Malformed JSON should fail the parse for that file. Empty lines are ignored.

## Shared Output Model

All providers are normalized into this model:

```go
type SessionUsage struct {
    Summary SessionSummary
    Calls   []UsageCall
}

type SessionSummary struct {
    SessionHash   string
    StartedAt     string
    EndedAt       string
    UserTurnCount int
    LLMCallCount  int
    Tokens        TokenSummary
}

type TokenSummary struct {
    Input     int
    Output    int
    Cache     int
    Reasoning int
    Total     int
}

type UsageCall struct {
    CallKey    string
    CallIndex  int
    OccurredAt string
    Model      string
    Tokens     TokenSummary
}
```

Definitions:

- `user_turn_count`: number of user prompts linked to the session usage.
- `llm_call_count`: number of token usage records counted for that session.
- `input`: non-cached input tokens when the provider exposes cache separately.
- `output`: generated output tokens.
- `cache`: cached or cache-related input tokens.
- `reasoning`: reasoning output tokens, when exposed by provider.
- `total`: provider total when available; otherwise computed total.
- `call_key`: hashed stable call identifier. Do not store raw request/message
  IDs remotely unless explicitly allowed later.

All `started_at`, `ended_at`, `updated_at`, `modified_at`, `last_parsed_at`,
local `synced_at`, call `occurred_at`, and call `updated_at` values are stored
as RFC3339Nano strings in KST.

## Device Identity

Each local installation has one stable device identity.

Generation:

- Generate `device_id` as a random UUID v4.
- Generate it after successful `token-agent login`, or on the first
  `token-agent sync` if it does not exist yet.
- Do not derive `device_id` from hostname or other low-entropy machine values.

Local metadata:

- `device_label`: OS hostname, falling back to `unknown-device`.
- `platform`: Go `runtime.GOOS`, expected to be `darwin`, `linux`, or
  `windows` for supported targets.

The device ID is a stable local identifier, not a security boundary. The Edge
Function validates the UUID shape and binds rows to the authenticated
`user_id`.

## Session Hashing

Do not store raw session IDs.

Generate session hash as:

```text
sha256(provider + "-session:" + rawSessionID)
```

Store the lowercase hex digest without a prefix.

For source files, do not store the local path. Generate `file_key` as:

```text
sha256(absPath)
```

Store the lowercase hex digest.

## Codex Parser

Input root: `~/.codex/sessions`.

Relevant record shape:

```json
{
  "timestamp": "2026-06-02T05:17:08.748Z",
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 16100,
        "cached_input_tokens": 3456,
        "output_tokens": 220,
        "reasoning_output_tokens": 133,
        "total_tokens": 16320
      },
      "last_token_usage": {
        "input_tokens": 16100,
        "cached_input_tokens": 3456,
        "output_tokens": 220,
        "reasoning_output_tokens": 133,
        "total_tokens": 16320
      }
    }
  }
}
```

Parsing rules:

- Read `session_meta.payload.id` as raw session ID. If absent, fallback to the
  filename without `.jsonl`.
- Count `event_msg.payload.type == "user_message"` as `user_turn_count`.
- Count `event_msg.payload.type == "token_count"` with usable
  `total_token_usage` as one `llm_call_count`.
- Prefer `payload.info.total_token_usage`.
- Fallback to `payload.total_token_usage` for older/variant records.
- For call-level tokens, prefer `payload.info.last_token_usage`.
- Fallback to `payload.last_token_usage` for older/variant records.
- If `last_token_usage` is absent, calculate the call-level usage as the
  non-negative delta between current and previous cumulative
  `total_token_usage`.
- If this is the first usable token count and `last_token_usage` is absent, use
  the current cumulative `total_token_usage` as that first call.
- Skip `token_count` records that do not include total token usage.
- If no usable token count exists in the file, skip the file using
  provider-specific `ErrNoTokenCounts`.
- Build one `UsageCall` per usable `token_count`.
- Set the session token totals to the sum of normalized call tokens.
- `started_at` is the timestamp of the first usable `token_count`.
- `ended_at` is the timestamp of the last usable `token_count`.
- Convert timestamps to KST.

Codex token mapping:

```text
input     = max(input_tokens - cached_input_tokens, 0)
output    = output_tokens
cache     = cached_input_tokens
reasoning = reasoning_output_tokens
total     = total_tokens
```

Rationale: Codex total usage includes cached input in `input_tokens`, but the
normalized model keeps non-cached input and cache separate.

## Claude Code Parser

Input root: `~/.claude/projects`.

Relevant record shape:

```json
{
  "type": "assistant",
  "timestamp": "2026-06-02T09:56:40.393Z",
  "sessionId": "uuid",
  "uuid": "message-uuid",
  "parentUuid": "parent-uuid",
  "requestId": "request-id",
  "isSidechain": false,
  "message": {
    "role": "assistant",
    "id": "message-id",
    "usage": {
      "input_tokens": 1800,
      "output_tokens": 4665,
      "cache_creation_input_tokens": 23555,
      "cache_read_input_tokens": 0
    }
  }
}
```

Parsing rules:

- Read raw session ID from `sessionId`. If absent, fallback to the filename
  without `.jsonl`.
- Collect records with `message.usage`.
- If no usage entries exist, skip the file using provider-specific
  `ErrNoUsage`.
- `started_at` is the earliest timestamp among usage entries.
- `ended_at` is the latest timestamp among usage entries.
- Convert timestamps to KST.
- Deduplicate usage entries before summing tokens.
- Build one `UsageCall` per deduped usage entry.
- Preserve `message.model` as call `model` when present.

Claude user prompt detection:

- Count a record as a user prompt when:
  - `type == "user"`
  - `message.role == "user"`
  - `isMeta == false`
  - content is a JSON string, or content is an array containing text blocks and
    no `tool_result` blocks.
- Prefer linked user prompt count:
  - Build a map of records by `uuid`.
  - For each deduped usage entry, walk its `parentUuid` chain.
  - If a parent record is a user prompt, count that prompt UUID once.
  - If no linked prompts can be found, fallback to raw user prompt count.

Claude usage dedupe:

- Match duplicate usage entries by `message.id` and `requestId`.
- Also match by `message.id` when either entry has `isSidechain = true`.
- If a duplicate is found:
  - Prefer the non-sidechain entry over sidechain.
  - Otherwise keep the entry with larger usage total.

Claude token mapping after dedupe:

```text
input     = sum(input_tokens)
output    = sum(output_tokens)
cache     = sum(cache_creation_input_tokens + cache_read_input_tokens)
reasoning = 0
total     = input + output + cache
```

This matches the verified behavior against `ccusage` for the tested local
Claude Code session files.

## SQLite State

Open `~/.mylocalagenttoken/usage.sqlite`. Create parent directory with mode
`0700`. Migrate automatically on open.

### `sessions`

```sql
create table if not exists sessions (
  session_hash text primary key,
  provider text not null,
  started_at text not null,
  ended_at text not null,
  user_turn_count integer not null,
  llm_call_count integer not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cache_tokens integer not null,
  reasoning_tokens integer not null,
  total_tokens integer not null,
  updated_at text not null,
  need_sync integer not null default 1,
  synced_at text
);
```

Indexes:

```sql
create index if not exists idx_sessions_provider_started_at
  on sessions(provider, started_at);

create index if not exists idx_sessions_need_sync
  on sessions(need_sync, provider, started_at);
```

When inserting or updating a parsed session:

- Set `updated_at` to now in KST.
- Set `need_sync = 1`.
- Set `synced_at = null`.

When a sync succeeds:

- Set `need_sync = 0`.
- Set `synced_at` to now in KST.
- Include `where provider = ? and session_hash = ? and updated_at = ?` in the
  update to avoid marking a concurrently updated row as synced.

Existing databases without `need_sync` or `synced_at` must be migrated with:

```sql
alter table sessions add column need_sync integer not null default 1;
alter table sessions add column synced_at text;
```

The first sync after adding `need_sync` may cause all existing session dates to
be recomputed and uploaded once. After that, only changed session dates should
be recomputed and uploaded.

### `local_device`

```sql
create table if not exists local_device (
  device_id text primary key,
  device_label text not null,
  platform text not null,
  created_at text not null,
  updated_at text not null
);
```

Rules:

- Store exactly one active local device row.
- Reuse the existing `device_id` across subsequent runs.
- If hostname or platform changes, update `device_label`, `platform`, and
  `updated_at`, while preserving `device_id`.
- Store `created_at` and `updated_at` in KST.

### `usage_calls`

```sql
create table if not exists usage_calls (
  provider text not null,
  session_hash text not null,
  call_key text not null,
  call_index integer not null,
  occurred_at text not null,
  model text,
  input_tokens integer not null,
  output_tokens integer not null,
  cache_tokens integer not null,
  reasoning_tokens integer not null,
  total_tokens integer not null,
  source_file_key text not null,
  updated_at text not null,
  primary key(provider, session_hash, call_key),
  foreign key(session_hash) references sessions(session_hash)
);
```

Indexes:

```sql
create index if not exists idx_usage_calls_session
  on usage_calls(provider, session_hash, call_index);

create index if not exists idx_usage_calls_source_file
  on usage_calls(provider, source_file_key);
```

When reparsing a changed file:

- Delete existing `usage_calls` rows for the same `provider` and
  `source_file_key`.
- Insert the newly parsed call rows.
- Upsert the owning `sessions` row with the call-summed totals.

### `source_files`

```sql
create table if not exists source_files (
  file_key text primary key,
  provider text not null,
  size_bytes integer not null,
  modified_at text not null,
  session_hash text not null,
  last_parsed_at text not null,
  foreign key(session_hash) references sessions(session_hash)
);
```

Index:

```sql
create index if not exists idx_source_files_provider_modified_at
  on source_files(provider, modified_at);
```

Incremental local parsing:

- For each JSONL file, calculate:
  - `file_key = sha256(absPath)`
  - `size_bytes = os.Stat(path).Size()`
  - `modified_at = os.Stat(path).ModTime().In(KST).Format(RFC3339Nano)`
- If `source_files` has the same `provider`, `file_key`, `size_bytes`, and
  `modified_at`, and matching `usage_calls` rows already exist, reuse the
  cached session summary from SQLite.
- Otherwise parse the file and upsert `sessions`, `usage_calls`, and
  `source_files`.
- If parsing fails with provider-specific "no usage" skip error, delete the
  source file cache row and count the file as skipped.

## Supabase Remote Schema

Remote device table: `public.usage_devices`.

```sql
create table public.usage_devices (
  user_id uuid not null,
  device_id uuid not null,
  device_label text not null,
  platform text not null check (platform in ('darwin', 'linux', 'windows')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
```

Enable RLS and allow authenticated users to read/write only their own rows:

```sql
alter table public.usage_devices enable row level security;

create policy "usage_devices_select_own"
on public.usage_devices
for select
using (auth.uid() = user_id);

create policy "usage_devices_insert_own"
on public.usage_devices
for insert
with check (auth.uid() = user_id);

create policy "usage_devices_update_own"
on public.usage_devices
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Remote daily aggregate table: `public.usage_daily`.

```sql
create table public.usage_daily (
  user_id uuid not null,
  device_id uuid not null,
  usage_date date not null,
  provider text not null check (provider in ('codex', 'claude')),
  model text not null,
  session_count integer not null,
  llm_call_count integer not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  cache_tokens bigint not null,
  reasoning_tokens bigint not null,
  total_tokens bigint not null,
  first_used_at timestamptz not null,
  last_used_at timestamptz not null,
  local_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, device_id, usage_date, provider, model),
  foreign key (user_id, device_id)
    references public.usage_devices (user_id, device_id)
    on delete cascade
);
```

Enable RLS and allow authenticated users to read/write only their own rows:

```sql
alter table public.usage_daily enable row level security;

create policy "usage_daily_select_own"
on public.usage_daily
for select
using (auth.uid() = user_id);

create policy "usage_daily_insert_own"
on public.usage_daily
for insert
with check (auth.uid() = user_id);

create policy "usage_daily_update_own"
on public.usage_daily
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Supabase stores and displays `timestamptz` in the database timezone, normally
UTC. Keep the database in UTC and format as KST in SQL or UI when needed:

```sql
select first_used_at at time zone 'Asia/Seoul' as first_used_at_kst
from public.usage_daily;
```

## Sync Payload

The CLI sends:

```json
{
  "device": {
    "device_id": "8e4c5f92-3d1a-4a73-90a2-8f25a6a3c1b4",
    "device_label": "jtlee-macbook-pro",
    "platform": "darwin"
  },
  "daily": [
    {
      "usage_date": "2026-06-03",
      "provider": "codex",
      "model": "gpt-5-codex",
      "session_count": 1,
      "llm_call_count": 2,
      "input_tokens": 100,
      "output_tokens": 20,
      "cache_tokens": 80,
      "reasoning_tokens": 5,
      "total_tokens": 205,
      "first_used_at": "2026-06-03T10:00:00+09:00",
      "last_used_at": "2026-06-03T10:05:00+09:00",
      "local_updated_at": "2026-06-03T10:06:00+09:00"
    }
  ]
}
```

Do not include `user_id` in the client payload. The Edge Function must derive
`user_id` from the authenticated Supabase user.

Sync behavior:

- Read only local `sessions.need_sync = 1`.
- Ensure a local device exists before building the payload.
- Do not include local `sessions` or `usage_calls` rows in the Supabase
  payload.
- If no pending sessions exist, return `daily_uploaded: 0` without making a
  network request.
- For pending sessions, derive affected provider/date pairs from
  `usage_calls.occurred_at`.
- Recompute each affected provider/date aggregate from all local calls for that
  day, grouped by `model`.
- After the endpoint succeeds, mark the uploaded sessions as synced.

## Supabase Edge Function

Function slug: `sync-usage`.

Settings:

- `verify_jwt = true`
- Method: POST only
- Request auth: `Authorization: Bearer <Supabase access token>`
- Max daily rows per request: 5000

Behavior:

- Reject non-POST with 405.
- Parse JSON body.
- Validate `device.device_id` as UUID.
- Validate `device.device_label` as non-empty string.
- Validate `device.platform` as `darwin`, `linux`, or `windows`.
- Validate `daily` array and each aggregate field.
- Create Supabase client with project anon key and incoming Authorization
  header.
- Call `supabase.auth.getUser()` and reject if no user.
- Upsert `usage_devices` using `user_id,device_id`, setting
  `last_seen_at = new Date().toISOString()`.
- Map each daily item to a row and set `user_id` to `userData.user.id`.
- Set `device_id` on uploaded daily rows.
- Set remote `synced_at` to `new Date().toISOString()`.
- Upsert into `usage_daily` with conflict target:
  `user_id,device_id,usage_date,provider,model`.
- Return `{ "upserted": dailyRows.length }`.

The Edge Function must not trust a client-provided `user_id`.

## Privacy Requirements

Never store or upload:

- Prompt text
- Assistant output text
- Tool input/output
- Raw JSONL line content
- Raw local file paths
- Raw provider session IDs
- Supabase access or refresh tokens in stdout/log output

Allowed local data:

- Provider name
- Hashed session ID
- Session timestamps
- User prompt count
- LLM usage call count
- Token totals
- Call-level timestamps, model names, call hashes, and token totals
- Device ID, label, platform, created/updated timestamps

Allowed remote data:

- Authenticated Supabase `user_id`
- Device ID, label, platform, first seen, and last seen timestamps
- Usage date
- Provider name
- Model name
- Daily session count
- Daily LLM usage call count
- Daily token totals
- First/last local usage timestamp for that day/model/provider
- Local update and remote sync timestamps

Allowed local-only data:

- `auth.json` with Supabase access and refresh tokens, mode `0600`
- `source_files.file_key`, which is a hash of absolute local file path
- JSONL file size and mtime for incremental parsing
- Hashed session ID
- Session timestamps
- User prompt count
- Session-level token totals
- `usage_calls` call-level timestamps, model names, call hashes, and token
  totals

Do not upload:

- Hashed session IDs
- Per-session rows
- Per-call rows

## Test Coverage Requirements

Tests should cover at least:

- Codex parser:
  - KST timestamp conversion
  - user message count
  - token count handling
  - skipped files with no usable token usage
  - no prompt/output/path leakage
  - input token normalization excluding cache
- Claude parser:
  - KST timestamp conversion
  - usage dedupe
  - linked user prompt count
  - cache creation + cache read aggregation
  - no prompt/output/path leakage
- SQLite:
  - audit timestamps are KST
  - existing timestamps normalize to KST on open
  - local device UUID is created once and reused
  - unchanged source files are reused
  - call rows are stored and replaced when a source file is reparsed
  - pending daily usage recomputes the whole affected day and groups by model
  - changed source files mark sessions `need_sync = 1`
  - successful sync marks uploaded pending sessions synced
- CLI:
  - default inspect parses both providers
  - `--quiet` suppresses stdout while still writing state
  - sync payload does not include `user_id`
  - sync payload includes device metadata
  - sync payload includes daily aggregate rows
  - sync payload does not include local `sessions`
  - sync payload does not include local `usage_calls`
  - second sync after successful upload sends zero daily rows and makes no network
    request
  - login does not print passwords, access tokens, or refresh tokens
  - expired auth refreshes before sync

Primary verification command:

```bash
GOCACHE=/private/tmp/local-agent-usage-gocache go test -count=1 ./...
```

Build command:

```bash
go build -o ~/.mylocalagenttoken/bin/token-agent ./cmd/agent-token
```

## Intended Product Evolution

The current Google OAuth login is a localhost callback flow. For SSH/headless
environments, add a device-code or browser-mediated polling flow later while
reusing the same `auth.json` shape and refresh behavior.

Device identity currently uses a locally generated UUID. Later, consider
server-issued device registration or signatures if tamper resistance is needed.
