# Local Agent Usage Spec

This document describes the current implementation of `local-agent-usage`.
It is intended to be sufficient for another code agent to rebuild the same
local parser, SQLite state store, and Supabase sync behavior without reading the
existing source first.

## Goal

Build a local CLI named `token-agent` that reads local JSONL session files from
Codex and Claude Code, extracts token usage summaries only, stores sanitized
session summaries in SQLite, and optionally uploads changed session summaries to
Supabase.

The tool must not store or upload prompts, assistant outputs, raw JSONL lines,
raw local file paths, or other message content. The only session identity stored
locally/remotely is a deterministic hash of the provider-specific session ID.

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

Current MVP login uses Supabase email/password auth. This is temporary; the
intended product flow is to replace the first token acquisition step with a web
dashboard Google OAuth/PKCE flow later.

```bash
TOKEN_AGENT_PASSWORD='password' token-agent login --email user@example.com
```

Important flags:

```text
--state-dir PATH        default ~/.mylocalagenttoken
--supabase-url URL      Supabase project URL, env TOKEN_AGENT_SUPABASE_URL
--anon-key KEY          Supabase anon key, env TOKEN_AGENT_SUPABASE_ANON_KEY
--sync-endpoint URL     Edge Function URL, env TOKEN_AGENT_SYNC_ENDPOINT
--email EMAIL           Supabase Auth email, env TOKEN_AGENT_EMAIL
--password VALUE        direct password; avoid for shell history
--password-env NAME     env var containing password, default TOKEN_AGENT_PASSWORD
--quiet                 suppress JSON output
```

On success, write `auth.json` with mode `0600`.
Do not print access tokens, refresh tokens, or passwords.

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

Uploads only locally changed sessions to Supabase.

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
- Read only rows where `sessions.need_sync = 1`.
- If no pending rows exist, return `sessions_uploaded: 0` and do not call the
  network.
- If no `--token` is supplied, load `auth.json`.
- Refresh the access token if it is expired or will expire within five minutes.
- POST pending sessions to the sync endpoint.
- After a successful HTTP 2xx response, mark uploaded rows as synced:
  `need_sync = 0`, `synced_at = now KST`.
- If upload fails, leave `need_sync = 1` so the next sync retries.

Output shape:

```json
{
  "sessions_uploaded": 3
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
```

Definitions:

- `user_turn_count`: number of user prompts linked to the session usage.
- `llm_call_count`: number of token usage records counted for that session.
- `input`: non-cached input tokens when the provider exposes cache separately.
- `output`: generated output tokens.
- `cache`: cached or cache-related input tokens.
- `reasoning`: reasoning output tokens, when exposed by provider.
- `total`: provider total when available; otherwise computed total.

All `started_at`, `ended_at`, `updated_at`, `modified_at`, `last_parsed_at`,
and local `synced_at` values are stored as RFC3339Nano strings in KST.

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
      }
    }
  }
}
```

Parsing rules:

- Read `session_meta.payload.id` as raw session ID.
- Count `event_msg.payload.type == "user_message"` as `user_turn_count`.
- Count `event_msg.payload.type == "token_count"` with usable
  `total_token_usage` as one `llm_call_count`.
- Prefer `payload.info.total_token_usage`.
- Fallback to `payload.total_token_usage` for older/variant records.
- Skip `token_count` records that do not include total token usage.
- If no usable token count exists in the file, skip the file using
  provider-specific `ErrNoTokenCounts`.
- Use token usage from the latest usable `token_count` record as the session
  total. This avoids double-counting cumulative `total_token_usage` snapshots.
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

The first sync after adding `need_sync` may upload all existing sessions once.
After that, only changed sessions should be uploaded.

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
  `modified_at`, reuse the cached session summary from SQLite.
- Otherwise parse the file and upsert both `sessions` and `source_files`.
- If parsing fails with provider-specific "no usage" skip error, delete the
  source file cache row and count the file as skipped.

## Supabase Remote Schema

Remote table: `public.usage_sessions`.

```sql
create table public.usage_sessions (
  user_id uuid not null,
  session_hash text not null,
  provider text not null check (provider in ('codex', 'claude')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  user_turn_count integer not null,
  llm_call_count integer not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  cache_tokens bigint not null,
  reasoning_tokens bigint not null,
  total_tokens bigint not null,
  local_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, provider, session_hash)
);
```

Enable RLS and allow authenticated users to read/write only their own rows:

```sql
alter table public.usage_sessions enable row level security;

create policy "usage_sessions_select_own"
on public.usage_sessions
for select
using (auth.uid() = user_id);

create policy "usage_sessions_insert_own"
on public.usage_sessions
for insert
with check (auth.uid() = user_id);

create policy "usage_sessions_update_own"
on public.usage_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Supabase stores and displays `timestamptz` in the database timezone, normally
UTC. Keep the database in UTC and format as KST in SQL or UI when needed:

```sql
select started_at at time zone 'Asia/Seoul' as started_at_kst
from public.usage_sessions;
```

## Sync Payload

The CLI sends:

```json
{
  "sessions": [
    {
      "session_hash": "hex_sha256",
      "provider": "codex",
      "started_at": "2026-06-03T10:00:00+09:00",
      "ended_at": "2026-06-03T10:05:00+09:00",
      "user_turn_count": 1,
      "llm_call_count": 2,
      "input_tokens": 100,
      "output_tokens": 20,
      "cache_tokens": 80,
      "reasoning_tokens": 5,
      "total_tokens": 205,
      "local_updated_at": "2026-06-03T10:06:00+09:00"
    }
  ]
}
```

Do not include `user_id` in the client payload. The Edge Function must derive
`user_id` from the authenticated Supabase user.

## Supabase Edge Function

Function slug: `sync-usage`.

Settings:

- `verify_jwt = true`
- Method: POST only
- Request auth: `Authorization: Bearer <Supabase access token>`
- Max sessions per request: 500

Behavior:

- Reject non-POST with 405.
- Parse JSON body.
- Validate `sessions` array and each session field.
- Create Supabase client with project anon key and incoming Authorization
  header.
- Call `supabase.auth.getUser()` and reject if no user.
- Map each session to a row and set `user_id` to `userData.user.id`.
- Set remote `synced_at` to `new Date().toISOString()`.
- Upsert into `usage_sessions` with conflict target:
  `user_id,provider,session_hash`.
- Return `{ "upserted": rows.length }`.

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

Allowed local/remote data:

- Provider name
- Hashed session ID
- Session timestamps
- User prompt count
- LLM usage call count
- Token totals
- Local update/sync timestamps

Allowed local-only data:

- `auth.json` with Supabase access and refresh tokens, mode `0600`
- `source_files.file_key`, which is a hash of absolute local file path
- JSONL file size and mtime for incremental parsing

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
  - unchanged source files are reused
  - changed source files mark sessions `need_sync = 1`
  - successful sync marks only uploaded sessions synced
- CLI:
  - default inspect parses both providers
  - `--quiet` suppresses stdout while still writing state
  - sync payload does not include `user_id`
  - second sync after successful upload sends zero sessions and makes no network
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

Current email/password `login` exists to validate Supabase sync.
For the product dashboard, replace initial login with Google OAuth:

- `token-agent login` opens the web dashboard login page.
- User signs in with Google.
- CLI receives the Supabase session through localhost callback + PKCE, or a
  device-code polling flow for SSH/headless environments.
- CLI stores the same `auth.json` shape.
- `sync` and refresh behavior remain reusable.

Device identity is intentionally deferred for MVP. When added, generate a
local device UUID and later consider server-issued registration or signatures if
tamper resistance is required.
