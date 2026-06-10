drop function if exists public.get_weekly_ranking(date);

create function public.get_weekly_ranking(week_start date default null)
returns table (
  rank_position bigint,
  display_name text,
  avatar_style text,
  input_tokens bigint,
  output_tokens bigint,
  cache_tokens bigint,
  total_tokens bigint,
  is_viewer boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with week as (
    -- 월요일로 정규화: 아무 날짜가 와도 그 날이 속한 주(월~일)를 집계한다
    select date_trunc('week', coalesce(week_start, current_date))::date as start
  ),
  totals as (
    select
      d.user_id,
      sum(d.input_tokens) as input_tokens,
      sum(d.output_tokens) as output_tokens,
      sum(d.cache_tokens) as cache_tokens,
      sum(d.input_tokens + d.output_tokens) as total_tokens
    from public.usage_daily d
    cross join week w
    where d.usage_date >= w.start
      and d.usage_date < w.start + 7
    group by d.user_id
  ),
  ranked as (
    select
      rank() over (order by t.total_tokens desc) as rank_position,
      p.display_name,
      p.avatar_style,
      t.input_tokens,
      t.output_tokens,
      t.cache_tokens,
      t.total_tokens,
      t.user_id
    from totals t
    join public.profiles p on p.user_id = t.user_id
    where p.ranking_opt_in
  )
  select
    r.rank_position,
    r.display_name,
    r.avatar_style,
    r.input_tokens,
    r.output_tokens,
    r.cache_tokens,
    r.total_tokens,
    r.user_id = auth.uid() as is_viewer
  from ranked r
  -- 상위 100명 + (100위 밖이라도) 호출자 본인의 행은 항상 포함
  where r.rank_position <= 100 or r.user_id = auth.uid()
  order by r.rank_position;
$$;

revoke execute on function public.get_weekly_ranking(date) from public, anon;
grant execute on function public.get_weekly_ranking(date) to authenticated;
