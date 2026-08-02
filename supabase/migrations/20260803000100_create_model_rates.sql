-- Published per-model rates, in USD per million tokens.
--
-- Cost is never stored on a usage row: it is computed at read time by joining a
-- usage row to the rate that was in effect on the day it ran. That way a model
-- whose rate is not registered yet (today: Codex before its rates were added)
-- lights up retroactively the moment a row is inserted here, with no re-parse.
--
-- Key notes:
--   effective_from  A rate change is a new row, never an update, so historical
--                   usage keeps the price it was actually bought at. Rows may be
--                   dated in the future; the lookup picks the latest row on or
--                   before the usage date.
--   context_tier    OpenAI charges double past 272K input tokens per request.
--                   Anthropic serves its whole 1M window at one rate, so Claude
--                   only ever has a 'short' row.
--   speed           Fast mode is not a fixed multiple of standard (gpt-5.6-sol
--                   is 2x, gpt-5.5 is 2.5x), so every rate is stored explicitly
--                   rather than derived.
--   null rates      A null means the provider has no such concept, which is not
--                   the same as free. Codex reports no cache-write TTL, so its
--                   writes land in the 5-minute column and the 1-hour column
--                   stays null.
create table if not exists public.model_rates (
  provider text not null check (provider in ('codex', 'claude')),
  model text not null,
  effective_from date not null,
  context_tier text not null default 'short' check (context_tier in ('short', 'long')),
  speed text not null default 'standard' check (speed in ('standard', 'fast')),
  input_per_mtok numeric(10, 4) not null,
  cache_write_5m_per_mtok numeric(10, 4),
  cache_write_1h_per_mtok numeric(10, 4),
  cache_read_per_mtok numeric(10, 4) not null,
  output_per_mtok numeric(10, 4) not null,
  currency text not null default 'USD',
  -- Input-token count above which context_tier 'long' applies. Null on rows that
  -- have no tier split.
  long_context_threshold integer,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (provider, model, effective_from, context_tier, speed)
);

alter table public.model_rates enable row level security;

-- Rates are public reference data: every signed-in user prices their own usage
-- against the same table, and only the service role may change it.
drop policy if exists "model_rates_select_all" on public.model_rates;
create policy "model_rates_select_all"
on public.model_rates
for select
to authenticated, anon
using (true);

-- ---------------------------------------------------------------------------
-- Anthropic. One tier only: the full 1M context window bills at the base rate.
-- Cache writes are 1.25x (5m) and 2x (1h) of input; cache reads are 0.1x.
-- ---------------------------------------------------------------------------
insert into public.model_rates (
  provider, model, effective_from, context_tier, speed,
  input_per_mtok, cache_write_5m_per_mtok, cache_write_1h_per_mtok,
  cache_read_per_mtok, output_per_mtok, note
) values
  ('claude', 'claude-fable-5',    date '2020-01-01', 'short', 'standard', 10.00, 12.50, 20.00, 1.00, 50.00, ''),
  ('claude', 'claude-mythos-5',   date '2020-01-01', 'short', 'standard', 10.00, 12.50, 20.00, 1.00, 50.00, ''),
  ('claude', 'claude-opus-5',     date '2020-01-01', 'short', 'standard',  5.00,  6.25, 10.00, 0.50, 25.00, ''),
  ('claude', 'claude-opus-4-8',   date '2020-01-01', 'short', 'standard',  5.00,  6.25, 10.00, 0.50, 25.00, ''),
  ('claude', 'claude-opus-4-7',   date '2020-01-01', 'short', 'standard',  5.00,  6.25, 10.00, 0.50, 25.00, ''),
  ('claude', 'claude-opus-4-6',   date '2020-01-01', 'short', 'standard',  5.00,  6.25, 10.00, 0.50, 25.00, ''),
  ('claude', 'claude-sonnet-4-6', date '2020-01-01', 'short', 'standard',  3.00,  3.75,  6.00, 0.30, 15.00, ''),
  ('claude', 'claude-sonnet-4-5', date '2020-01-01', 'short', 'standard',  3.00,  3.75,  6.00, 0.30, 15.00, ''),
  ('claude', 'claude-haiku-4-5',  date '2020-01-01', 'short', 'standard',  1.00,  1.25,  2.00, 0.10,  5.00, ''),
  -- Sonnet 5 runs at introductory pricing through 2026-08-31. The September row
  -- is inserted now so the switch needs no action on the day.
  ('claude', 'claude-sonnet-5',   date '2020-01-01', 'short', 'standard',  2.00,  2.50,  4.00, 0.20, 10.00, 'introductory pricing through 2026-08-31'),
  ('claude', 'claude-sonnet-5',   date '2026-09-01', 'short', 'standard',  3.00,  3.75,  6.00, 0.30, 15.00, 'standard pricing'),
  -- Fast mode: Opus 5 / 4.8 only. Caching multipliers stack on top of the fast
  -- base rate, so the write and read columns are 1.25x / 2x / 0.1x of $10.
  ('claude', 'claude-opus-5',     date '2020-01-01', 'short', 'fast',     10.00, 12.50, 20.00, 1.00, 50.00, 'fast mode (research preview)'),
  ('claude', 'claude-opus-4-8',   date '2020-01-01', 'short', 'fast',     10.00, 12.50, 20.00, 1.00, 50.00, 'fast mode (research preview)'),
  -- Locally generated assistant messages that never hit the API.
  ('claude', '<synthetic>',       date '2020-01-01', 'short', 'standard',  0.00,  0.00,  0.00, 0.00,  0.00, 'no API call')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- OpenAI. Long context applies per request above 272K input tokens; cache writes
-- have no TTL split so the 1-hour column stays null.
-- ---------------------------------------------------------------------------
insert into public.model_rates (
  provider, model, effective_from, context_tier, speed,
  input_per_mtok, cache_write_5m_per_mtok, cache_write_1h_per_mtok,
  cache_read_per_mtok, output_per_mtok, long_context_threshold, note
) values
  ('codex', 'gpt-5.6-sol',   date '2020-01-01', 'short', 'standard',  5.00,  6.25, null, 0.50, 30.00, 272000, ''),
  ('codex', 'gpt-5.6-sol',   date '2020-01-01', 'long',  'standard', 10.00, 12.50, null, 1.00, 45.00, 272000, ''),
  ('codex', 'gpt-5.6-sol',   date '2020-01-01', 'short', 'fast',     10.00, 12.50, null, 1.00, 60.00, 272000, 'fast mode'),
  ('codex', 'gpt-5.6-terra', date '2020-01-01', 'short', 'standard',  2.00,  2.50, null, 0.20, 12.00, 272000, ''),
  ('codex', 'gpt-5.6-terra', date '2020-01-01', 'long',  'standard',  4.00,  5.00, null, 0.40, 18.00, 272000, ''),
  ('codex', 'gpt-5.6-terra', date '2020-01-01', 'short', 'fast',      4.00,  5.00, null, 0.40, 24.00, 272000, 'fast mode'),
  ('codex', 'gpt-5.6-luna',  date '2020-01-01', 'short', 'standard',  0.20,  0.25, null, 0.02,  1.20, 272000, ''),
  ('codex', 'gpt-5.6-luna',  date '2020-01-01', 'long',  'standard',  0.40,  0.50, null, 0.04,  1.80, 272000, ''),
  ('codex', 'gpt-5.6-luna',  date '2020-01-01', 'short', 'fast',      0.40,  0.50, null, 0.04,  2.40, 272000, 'fast mode'),
  ('codex', 'gpt-5.3-codex', date '2020-01-01', 'short', 'standard',  1.75,  null, null, 0.175, 14.00, null, 'no cache-write pricing published'),
  ('codex', 'gpt-5.3-codex', date '2020-01-01', 'short', 'fast',      3.50,  null, null, 0.35,  28.00, null, 'fast mode'),
  -- The 5.5 and 5.4 generations publish no cache-write price, so those tokens
  -- fall back to the input rate at read time. Their fast multiplier is 2.5x,
  -- not the 2x the 5.6 line uses — the reason speed is a stored rate and not a
  -- derived one.
  ('codex', 'gpt-5.5',       date '2020-01-01', 'short', 'standard',  5.00,  null, null, 0.50,  30.00, 272000, ''),
  ('codex', 'gpt-5.5',       date '2020-01-01', 'long',  'standard', 10.00,  null, null, 1.00,  45.00, 272000, ''),
  ('codex', 'gpt-5.5',       date '2020-01-01', 'short', 'fast',     12.50,  null, null, 1.25,  75.00, 272000, 'fast mode (2.5x)'),
  ('codex', 'gpt-5.4',       date '2020-01-01', 'short', 'standard',  2.50,  null, null, 0.25,  15.00, 272000, ''),
  ('codex', 'gpt-5.4',       date '2020-01-01', 'long',  'standard',  5.00,  null, null, 0.50,  22.50, 272000, ''),
  ('codex', 'gpt-5.4',       date '2020-01-01', 'short', 'fast',      5.00,  null, null, 0.50,  30.00, 272000, 'fast mode'),
  -- mini and nano have no long-context tier at all, so no threshold either.
  ('codex', 'gpt-5.4-mini',  date '2020-01-01', 'short', 'standard',  0.75,  null, null, 0.075,  4.50, null, ''),
  ('codex', 'gpt-5.4-mini',  date '2020-01-01', 'short', 'fast',      1.50,  null, null, 0.15,   9.00, null, 'fast mode'),
  ('codex', 'gpt-5.4-nano',  date '2020-01-01', 'short', 'standard',  0.20,  null, null, 0.02,   1.25, null, ''),
  -- The pro tiers publish no cached-input price because they do not support
  -- caching. Cache read is set to the input rate so that a cached token, if one
  -- ever appears, bills as an ordinary input token instead of a free one.
  ('codex', 'gpt-5.5-pro',   date '2020-01-01', 'short', 'standard', 30.00,  null, null, 30.00, 180.00, 272000, 'no prompt caching'),
  ('codex', 'gpt-5.5-pro',   date '2020-01-01', 'long',  'standard', 60.00,  null, null, 60.00, 270.00, 272000, 'no prompt caching'),
  ('codex', 'gpt-5.4-pro',   date '2020-01-01', 'short', 'standard', 30.00,  null, null, 30.00, 180.00, 272000, 'no prompt caching'),
  ('codex', 'gpt-5.4-pro',   date '2020-01-01', 'long',  'standard', 60.00,  null, null, 60.00, 270.00, 272000, 'no prompt caching')
on conflict do nothing;

-- Models seen in local transcripts but absent from the published price lists:
--   codex-auto-review, gpt-5.3-codex-spark
-- They are deliberately left unregistered. The dashboard renders no amount for a
-- model without a rate rather than guessing, and adding a row here later fills in
-- its history retroactively.
