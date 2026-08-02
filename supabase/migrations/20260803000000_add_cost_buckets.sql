-- Cost buckets. Pricing needs finer granularity than input/output/cache: cache
-- writes bill at 1.25x (5-minute TTL) or 2x (1-hour TTL) of the input rate, and
-- both providers charge a premium for fast mode. The existing columns keep their
-- meaning; the new ones decompose input_tokens, with the invariant
--   input_tokens = input_raw_tokens + cache_write_5m_tokens + cache_write_1h_tokens
-- holding for every row written by parser version 10 or later. Rows uploaded by
-- an older agent keep zeros until that device re-parses.

alter table public.usage_daily
  add column if not exists input_raw_tokens bigint not null default 0,
  add column if not exists cache_write_5m_tokens bigint not null default 0,
  add column if not exists cache_write_1h_tokens bigint not null default 0,
  add column if not exists speed text not null default 'standard';

alter table public.usage_sessions
  add column if not exists input_raw_tokens bigint not null default 0,
  add column if not exists cache_write_5m_tokens bigint not null default 0,
  add column if not exists cache_write_1h_tokens bigint not null default 0,
  -- The dominant model by token volume, plus how many distinct models the
  -- session used, so the list can render a chip and a "+N".
  add column if not exists model text not null default '',
  add column if not exists model_count integer not null default 0,
  -- Fast mode costs 2-2.5x standard, so it has to reach the rate lookup. A row
  -- holds one speed; a session that toggled mid-run takes its majority side.
  add column if not exists speed text not null default 'standard';

alter table public.usage_session_agents
  add column if not exists input_raw_tokens bigint not null default 0,
  add column if not exists cache_write_5m_tokens bigint not null default 0,
  add column if not exists cache_write_1h_tokens bigint not null default 0,
  -- An agent lives in one source file and is effectively single-model, so
  -- grouping agent rows by model yields a session's per-model breakdown.
  add column if not exists model text not null default '',
  add column if not exists speed text not null default 'standard';

-- usage_daily is keyed per (user, device, date, provider, model). Fast mode bills
-- at a different rate, so it has to split the same way a model does.
alter table public.usage_daily drop constraint if exists usage_daily_pkey;
alter table public.usage_daily
  add constraint usage_daily_pkey
  primary key (user_id, device_id, usage_date, provider, model, speed);
