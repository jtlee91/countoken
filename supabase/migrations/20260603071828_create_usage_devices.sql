create table if not exists public.usage_devices (
  user_id uuid not null,
  device_id uuid not null,
  device_label text not null,
  platform text not null check (platform in ('darwin', 'linux', 'windows')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists idx_usage_devices_user_last_seen_at
  on public.usage_devices (user_id, last_seen_at desc);

alter table public.usage_devices enable row level security;

drop policy if exists "usage_devices_select_own" on public.usage_devices;
create policy "usage_devices_select_own"
on public.usage_devices
for select
using (auth.uid() = user_id);

drop policy if exists "usage_devices_insert_own" on public.usage_devices;
create policy "usage_devices_insert_own"
on public.usage_devices
for insert
with check (auth.uid() = user_id);

drop policy if exists "usage_devices_update_own" on public.usage_devices;
create policy "usage_devices_update_own"
on public.usage_devices
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
begin
  if to_regclass('public.usage_sessions') is not null then
    alter table public.usage_sessions add column if not exists device_id uuid;
    create index if not exists idx_usage_sessions_user_device_started_at
      on public.usage_sessions (user_id, device_id, started_at);
  end if;
end $$;
