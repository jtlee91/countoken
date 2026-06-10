create or replace function public.get_weekly_ranking(week_start date default null)
returns table (
  display_name text,
  avatar_style text,
  input_tokens bigint,
  output_tokens bigint,
  cache_tokens bigint,
  total_tokens bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with week as (
    -- 월요일로 정규화: 아무 날짜가 와도 그 날이 속한 주(월~일)를 집계한다
    select date_trunc('week', coalesce(week_start, current_date))::date as start
  )
  select
    p.display_name,
    p.avatar_style,
    sum(d.input_tokens) as input_tokens,
    sum(d.output_tokens) as output_tokens,
    sum(d.cache_tokens) as cache_tokens,
    sum(d.input_tokens + d.output_tokens) as total_tokens
  from public.usage_daily d
  join public.profiles p on p.user_id = d.user_id
  cross join week w
  where p.ranking_opt_in
    and d.usage_date >= w.start
    and d.usage_date < w.start + 7
  group by p.user_id, p.display_name, p.avatar_style
  order by total_tokens desc
  limit 100;
$$;

revoke execute on function public.get_weekly_ranking(date) from public, anon;
grant execute on function public.get_weekly_ranking(date) to authenticated;
