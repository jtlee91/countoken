create table if not exists public.usage_daily (
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

create index if not exists idx_usage_daily_user_date
  on public.usage_daily (user_id, usage_date);

create index if not exists idx_usage_daily_user_provider_date
  on public.usage_daily (user_id, provider, usage_date);

alter table public.usage_daily enable row level security;

drop policy if exists "usage_daily_select_own" on public.usage_daily;
create policy "usage_daily_select_own"
on public.usage_daily
for select
using (auth.uid() = user_id);

drop policy if exists "usage_daily_insert_own" on public.usage_daily;
create policy "usage_daily_insert_own"
on public.usage_daily
for insert
with check (auth.uid() = user_id);

drop policy if exists "usage_daily_update_own" on public.usage_daily;
create policy "usage_daily_update_own"
on public.usage_daily
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
