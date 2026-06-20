-- Per-session subagent breakdown: one row per "agent" (the main turn or one
-- subagent) within a rolled-up session. Codex spawns subagent threads and Claude
-- writes subagent files; both are aggregated under the parent session_hash, and
-- this table records each contributor so the dashboard can expand a session.
create table if not exists public.usage_session_agents (
  user_id uuid not null,
  session_hash text not null,
  provider text not null check (provider in ('codex', 'claude')),
  agent_key text not null,
  parent_agent_key text not null default '',
  depth integer not null default 0,
  label_type text not null default '',
  label_text text not null default '',
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_tokens bigint not null default 0,
  llm_call_count integer not null default 0,
  user_turn_count integer not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  local_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, session_hash, provider, agent_key)
);

create index if not exists idx_usage_session_agents_lookup
  on public.usage_session_agents (user_id, provider, session_hash);

alter table public.usage_session_agents enable row level security;

drop policy if exists "usage_session_agents_select_own" on public.usage_session_agents;
create policy "usage_session_agents_select_own"
on public.usage_session_agents
for select
using (auth.uid() = user_id);

drop policy if exists "usage_session_agents_insert_own" on public.usage_session_agents;
create policy "usage_session_agents_insert_own"
on public.usage_session_agents
for insert
with check (auth.uid() = user_id);

drop policy if exists "usage_session_agents_update_own" on public.usage_session_agents;
create policy "usage_session_agents_update_own"
on public.usage_session_agents
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
