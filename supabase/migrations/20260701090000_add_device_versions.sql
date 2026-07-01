-- Track which CLI/parser version each device is running, reported on every sync.
-- Lets us see how far a rollout has reached; null means a device that predates
-- version reporting (an older binary that still double-counts twin sessions).
alter table public.usage_devices add column if not exists agent_version text;
alter table public.usage_devices add column if not exists parser_version integer;
