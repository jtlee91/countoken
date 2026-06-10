create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  badge_key text not null unique,
  name text not null,
  description text not null,
  icon_path text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.badges enable row level security;

create policy "badges_select_all"
on public.badges
for select
to anon, authenticated
using (true);

create table if not exists public.user_badges (
  user_id uuid not null references auth.users (id) on delete cascade,
  badge_id uuid not null references public.badges (id) on delete cascade,
  earned_at timestamptz not null default now(),
  evidence_summary text not null default '',
  primary key (user_id, badge_id)
);

alter table public.user_badges enable row level security;

-- 조회는 본인 것만, 부여는 RPC(security definer)로만 한다 (insert 정책 없음)
create policy "user_badges_select_own"
on public.user_badges
for select
to authenticated
using ((select auth.uid()) = user_id);

insert into public.badges (badge_key, name, description, icon_path) values
  ('first-flight', '이륙', '첫 사용량 동기화에 성공했습니다.', '/assets/badges/deep-thinker.png'),
  ('night-owl', '올빼미', '세션 50개 이상, KST 21시~05시 시작 비율 20% 이상.', '/assets/badges/night-owl.png'),
  ('early-bird', '얼리버드', '세션 50개 이상, KST 07시~10시 시작 비율 20% 이상.', '/assets/badges/morning-builder.png'),
  ('dual-wielder', '양손잡이', 'Claude와 Codex를 모두 사용했습니다.', '/assets/badges/multi-agent-explorer.png'),
  ('multi-desk', '멀티 데스크', '기기를 2대 이상 연결했습니다.', '/assets/badges/cache-crafter.png'),
  ('steady-flame', '꾸준함', '7일 연속 매일 사용했습니다.', '/assets/badges/steady-flame.png'),
  ('token-burner', '토큰 버너', '하루에 토큰 5,000만 개 이상을 사용했습니다.', '/assets/badges/token-burner.png'),
  ('marathon', '마라톤 세션', '한 세션에서 유저 턴 100회 이상을 기록했습니다.', '/assets/badges/long-run-coder.png'),
  ('podium', '포디움', '참가자 30명 이상인 확정 주간 랭킹에서 Top 10에 들었습니다.', '/assets/badges/deep-thinker.png')
on conflict (badge_key) do nothing;

create or replace function public.grant_eligible_badges()
returns table (badge_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  total_sessions bigint;
  night_sessions bigint;
  early_sessions bigint;
  max_turns int;
  provider_count int;
  device_count int;
  max_daily bigint;
  streak bigint;
  podium boolean;
begin
  if uid is null then
    return;
  end if;

  select
    count(*),
    count(*) filter (
      where (s.started_at at time zone 'Asia/Seoul')::time >= time '21:00'
         or (s.started_at at time zone 'Asia/Seoul')::time < time '05:00'
    ),
    count(*) filter (
      where (s.started_at at time zone 'Asia/Seoul')::time >= time '07:00'
        and (s.started_at at time zone 'Asia/Seoul')::time < time '10:00'
    ),
    coalesce(max(s.user_turn_count), 0)
  into total_sessions, night_sessions, early_sessions, max_turns
  from public.usage_sessions s
  where s.user_id = uid;

  select count(distinct d.provider)
  into provider_count
  from public.usage_daily d
  where d.user_id = uid;

  select count(*)
  into device_count
  from public.usage_devices v
  where v.user_id = uid and not v.revoked;

  select coalesce(max(t.daily_total), 0)
  into max_daily
  from (
    select sum(d.input_tokens + d.output_tokens + d.cache_tokens) as daily_total
    from public.usage_daily d
    where d.user_id = uid
    group by d.usage_date
  ) t;

  -- 최장 연속 사용일: 연속된 날짜는 (날짜 - 행번호)가 같은 그룹으로 묶인다
  select coalesce(max(c), 0)
  into streak
  from (
    select count(*) as c
    from (
      select dd.usage_date - (row_number() over (order by dd.usage_date))::int as grp
      from (
        select distinct d.usage_date
        from public.usage_daily d
        where d.user_id = uid
      ) dd
    ) g
    group by g.grp
  ) s;

  -- 확정된 주(이번 주 제외, KST 기준)에서 참가자 30명 이상 + Top 10 경험
  select exists (
    select 1
    from (
      select
        w.user_id,
        rank() over (partition by w.wk order by w.total desc) as rnk,
        count(*) over (partition by w.wk) as participants
      from (
        select
          date_trunc('week', d.usage_date)::date as wk,
          d.user_id,
          sum(d.input_tokens + d.output_tokens + d.cache_tokens) as total
        from public.usage_daily d
        join public.profiles p on p.user_id = d.user_id and p.ranking_opt_in
        where date_trunc('week', d.usage_date)::date
              < date_trunc('week', (now() at time zone 'Asia/Seoul')::date)::date
        group by 1, 2
      ) w
    ) r
    where r.user_id = uid and r.rnk <= 10 and r.participants >= 30
  )
  into podium;

  return query
  with candidates(c_key, c_evidence) as (
    values
      ('first-flight',
        case when provider_count >= 1 then '첫 사용량 동기화 완료' end),
      ('night-owl',
        case when total_sessions >= 50
              and night_sessions::numeric / total_sessions >= 0.2
          then format('세션 %s개 중 야간 시작 %s개', total_sessions, night_sessions) end),
      ('early-bird',
        case when total_sessions >= 50
              and early_sessions::numeric / total_sessions >= 0.2
          then format('세션 %s개 중 아침 시작 %s개', total_sessions, early_sessions) end),
      ('dual-wielder',
        case when provider_count >= 2 then 'Claude와 Codex 모두 사용' end),
      ('multi-desk',
        case when device_count >= 2 then format('연결된 기기 %s대', device_count) end),
      ('steady-flame',
        case when streak >= 7 then format('최장 %s일 연속 사용', streak) end),
      ('token-burner',
        case when max_daily >= 50000000
          then format('하루 최대 %s tokens', to_char(max_daily, 'FM999,999,999,999')) end),
      ('marathon',
        case when max_turns >= 100 then format('한 세션 최대 %s턴', max_turns) end),
      ('podium',
        case when podium then '확정 주간 랭킹 Top 10 달성' end)
  ),
  granted as (
    insert into public.user_badges (user_id, badge_id, evidence_summary)
    select uid, b.id, c.c_evidence
    from candidates c
    join public.badges b on b.badge_key = c.c_key and b.active
    where c.c_evidence is not null
    on conflict (user_id, badge_id) do nothing
    returning user_badges.badge_id
  )
  select b.badge_key
  from granted g
  join public.badges b on b.id = g.badge_id;
end;
$$;

revoke execute on function public.grant_eligible_badges() from public, anon;
grant execute on function public.grant_eligible_badges() to authenticated;
