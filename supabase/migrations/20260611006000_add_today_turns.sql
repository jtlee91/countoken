-- 대시보드 '오늘' 칸에도 프롬프트(유저 턴) 수를 보여주기 위해 오늘 턴 수를 함께 반환한다
drop function if exists public.get_turn_totals();

create function public.get_turn_totals()
returns table (
  total_turns bigint,
  weekly_turns bigint,
  monthly_turns bigint,
  today_turns bigint
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(sum(s.user_turn_count), 0) as total_turns,
    coalesce(sum(s.user_turn_count) filter (
      where (s.started_at at time zone 'Asia/Seoul')::date
        >= date_trunc('week', (now() at time zone 'Asia/Seoul')::date)::date
    ), 0) as weekly_turns,
    coalesce(sum(s.user_turn_count) filter (
      where (s.started_at at time zone 'Asia/Seoul')::date
        >= date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date
    ), 0) as monthly_turns,
    coalesce(sum(s.user_turn_count) filter (
      where (s.started_at at time zone 'Asia/Seoul')::date
        = (now() at time zone 'Asia/Seoul')::date
    ), 0) as today_turns
  from public.usage_sessions s
  where s.user_id = auth.uid();
$$;

revoke execute on function public.get_turn_totals() from public, anon;
grant execute on function public.get_turn_totals() to authenticated;
