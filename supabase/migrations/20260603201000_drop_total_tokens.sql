set local lock_timeout = '5s';

alter table if exists public.usage_daily
  drop column if exists total_tokens;

alter table if exists public.usage_sessions
  drop column if exists total_tokens;

alter table if exists public.usage_calls
  drop column if exists total_tokens;

alter table if exists public.usage_turns
  drop column if exists total_tokens;

alter table if exists public.daily_usage_summaries
  drop column if exists total_tokens;
