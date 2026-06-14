-- 인사이트 탭용 본인 세션 집계 RPC.
-- security invoker라서 usage_sessions의 RLS(본인 행만 조회)가 그대로 적용된다.
-- 요일/시간대 분포, 연속 사용일, 에이전트·기기 분할, 누적/최고기록을 한 번에 JSON으로 반환한다.
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
prov as (
  select provider,
    sum(total) as tokens,
    count(*)::int as sessions,
    coalesce(sum(user_turn_count), 0) as turns,
    round(avg(minutes)::numeric, 1) as avg_min
  from base group by provider
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
