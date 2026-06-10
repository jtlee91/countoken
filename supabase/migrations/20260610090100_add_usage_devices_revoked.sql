alter table if exists public.usage_devices
  add column if not exists revoked boolean not null default false;
