alter table public.profiles
  add column if not exists public_slug text unique;

create or replace function public.get_share_card(slug text)
returns table (
  display_name text,
  avatar_style text,
  rank_position bigint,
  total_tokens bigint,
  badges jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select p.user_id, p.display_name, p.avatar_style
    from public.profiles p
    where p.public_slug = slug
  ),
  week as (
    select date_trunc('week', (now() at time zone 'Asia/Seoul')::date)::date as start
  ),
  weekly as (
    select
      d.user_id,
      sum(d.input_tokens + d.output_tokens + d.cache_tokens) as total
    from public.usage_daily d
    join public.profiles p on p.user_id = d.user_id and p.ranking_opt_in
    cross join week w
    where d.usage_date >= w.start
      and d.usage_date < w.start + 7
    group by d.user_id
  ),
  ranked as (
    select w.user_id, w.total, rank() over (order by w.total desc) as rnk
    from weekly w
  )
  select
    t.display_name,
    t.avatar_style,
    r.rnk as rank_position,
    r.total as total_tokens,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'key', b.badge_key,
            'name', b.name,
            'description', b.description,
            'icon_path', b.icon_path,
            'earned_at', ub.earned_at
          )
          order by ub.earned_at desc
        )
        from public.user_badges ub
        join public.badges b on b.id = ub.badge_id and b.active
        where ub.user_id = t.user_id
      ),
      '[]'::jsonb
    ) as badges
  from target t
  left join ranked r on r.user_id = t.user_id;
$$;

-- 공유 페이지는 비로그인 방문자도 봐야 하므로 anon에도 실행 허용
grant execute on function public.get_share_card(text) to anon, authenticated;
