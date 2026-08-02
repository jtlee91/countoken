-- Roll back the model and API-equivalent cost feature while preserving all
-- pre-existing usage data. The two preceding migrations remain in history
-- because they were already applied to production.

begin;

drop table if exists public.model_rates;

alter table public.usage_session_agents
  drop column if exists speed,
  drop column if exists model,
  drop column if exists cache_write_1h_tokens,
  drop column if exists cache_write_5m_tokens,
  drop column if exists input_raw_tokens;

alter table public.usage_sessions
  drop column if exists speed,
  drop column if exists model_count,
  drop column if exists model,
  drop column if exists cache_write_1h_tokens,
  drop column if exists cache_write_5m_tokens,
  drop column if exists input_raw_tokens;

alter table public.usage_daily
  drop column if exists cache_write_1h_tokens,
  drop column if exists cache_write_5m_tokens,
  drop column if exists input_raw_tokens;

commit;
