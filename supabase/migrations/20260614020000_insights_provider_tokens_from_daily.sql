-- 인사이트 "에이전트 성향"의 토큰 비율이 대시보드(에이전트별 사용량)와 어긋나는 문제 수정.
-- 기존 RPC는 provider 토큰을 usage_sessions(세션 단위, 최근 위주 부분집합)에서 합산해
-- usage_daily(전체 누적 원장) 기반 대시보드와 % 가 달랐다.
-- 이제 provider 토큰/세션수는 usage_daily에서, 세션당 평균분/turn은 usage_sessions에서 가져와
-- 토큰 % 는 대시보드와 일치시키고 "세션당 평균 N분" 같은 세션 기반 문구는 유지한다.
create or replace function public.get_user_insights()
returns jsonb
language sql
stable
set search_path = ''
as $$
with base as (
  select
    (s.started_at at time zone 'Asia/Seoul') as kst,
    s.input_tokens + s.cache_tokens + s.output_tokens as total,
    s.input_tokens,
    s.cache_tokens,
    s.output_tokens,
    s.user_turn_count,
    s.llm_call_count,
    s.provider,
    s.device_id,
    extract(epoch from (s.ended_at - s.started_at)) / 60.0 as minutes
  from public.usage_sessions s
  where s.user_id = auth.uid()
),
dow as (select extract(dow from kst)::int as d, sum(total) as t from base group by 1),
hrs as (select extract(hour from kst)::int as h, sum(total) as t from base group by 1),
days as (select distinct kst::date as dt from base),
grp as (select dt, dt - (row_number() over (order by dt))::int as g from days),
streaks as (select min(dt) as sd, max(dt) as ed, count(*)::int as len from grp group by g),
last_day as (select max(dt) as dt from days),
-- provider 토큰/세션수는 전체 누적 원장(usage_daily) 기준 — 대시보드와 동일
prov_daily as (
  select d.provider,
    coalesce(sum(d.input_tokens + d.cache_tokens + d.output_tokens), 0) as tokens,
    coalesce(sum(d.session_count), 0)::int as sessions
  from public.usage_daily d
  where d.user_id = auth.uid()
  group by d.provider
),
-- 세션당 평균분/turn은 세션 단위(usage_sessions) 기준
prov_min as (
  select provider,
    coalesce(sum(user_turn_count), 0) as turns,
    round(avg(minutes)::numeric, 1) as avg_min
  from base group by provider
),
prov as (
  select coalesce(pd.provider, pm.provider) as provider,
    coalesce(pd.tokens, 0) as tokens,
    coalesce(pd.sessions, 0) as sessions,
    coalesce(pm.turns, 0) as turns,
    coalesce(pm.avg_min, 0) as avg_min
  from prov_daily pd
  full outer join prov_min pm on pm.provider = pd.provider
),
dev as (
  select coalesce(d.platform, 'unknown') as platform,
    coalesce(d.device_label, 'unknown') as label,
    sum(b.total) as tokens,
    count(*)::int as sessions
  from base b
  left join public.usage_devices d
    on d.user_id = auth.uid() and d.device_id = b.device_id
  group by 1, 2
),
peak as (select kst::date as dt, sum(total) as t from base group by 1 order by 2 desc limit 1),
tot as (
  select count(*)::int as sessions,
    coalesce(sum(user_turn_count), 0) as turns,
    coalesce(sum(llm_call_count), 0) as calls,
    coalesce(sum(total), 0) as tokens,
    coalesce(sum(input_tokens), 0) as input,
    coalesce(sum(cache_tokens), 0) as cache,
    coalesce(sum(output_tokens), 0) as output,
    count(*) filter (
      where extract(hour from kst) >= 22 or extract(hour from kst) < 6
    )::int as night,
    min(kst::date) as first_day,
    max(kst::date) as last_day
  from base
)
select coalesce((
  select jsonb_build_object(
    'dowTokens', (
      select jsonb_agg(coalesce(dow.t, 0) order by gs.d)
      from generate_series(0, 6) gs(d) left join dow on dow.d = gs.d
    ),
    'hourTokens', (
      select jsonb_agg(coalesce(hrs.t, 0) order by gs.h)
      from generate_series(0, 23) gs(h) left join hrs on hrs.h = gs.h
    ),
    'currentStreak', coalesce(
      (select len from streaks where ed = (select dt from last_day)), 0),
    'maxStreak', coalesce((select max(len) from streaks), 0),
    'streakStart', (
      select to_char(sd, 'YYYY-MM-DD') from streaks
      where ed = (select dt from last_day)),
    'lastActiveDate', (select to_char(dt, 'YYYY-MM-DD') from last_day),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', provider, 'tokens', tokens, 'sessions', sessions,
        'turns', turns, 'avgMinutes', avg_min) order by tokens desc)
      from prov), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'platform', platform, 'label', label, 'tokens', tokens,
        'sessions', sessions) order by tokens desc)
      from dev), '[]'::jsonb),
    'peakDay', (
      select jsonb_build_object('date', to_char(dt, 'YYYY-MM-DD'), 'tokens', t)
      from peak),
    'totals', (
      select jsonb_build_object(
        'sessions', sessions, 'turns', turns, 'llmCalls', calls,
        'tokens', tokens, 'input', input, 'cache', cache, 'output', output,
        'nightSessions', night,
        'firstDay', to_char(first_day, 'YYYY-MM-DD'),
        'lastDay', to_char(last_day, 'YYYY-MM-DD'))
      from tot)
  )
  where exists (select 1 from base)
), '{}'::jsonb);
$$;

revoke execute on function public.get_user_insights() from public, anon;
grant execute on function public.get_user_insights() to authenticated;
