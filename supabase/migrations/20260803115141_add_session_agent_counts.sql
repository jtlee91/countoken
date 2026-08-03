-- Return exact visible subagent counts for a bounded set of sessions without
-- loading every agent row into the dashboard response. SECURITY INVOKER keeps
-- usage_session_agents RLS in force; the explicit auth.uid() predicate is
-- defense in depth and keeps the aggregate scoped to the current viewer.
create or replace function public.get_session_agent_counts(
  p_session_hashes text[]
)
returns table (
  session_hash text,
  subagent_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    agent.session_hash,
    count(*)::bigint as subagent_count
  from public.usage_session_agents as agent
  where agent.user_id = (select auth.uid())
    and agent.session_hash = any(p_session_hashes)
    and agent.agent_key <> 'main'
    and (
      agent.llm_call_count > 0
      or agent.input_tokens > 0
      or agent.output_tokens > 0
      or agent.cache_tokens > 0
    )
  group by agent.session_hash;
$$;

revoke all on function public.get_session_agent_counts(text[]) from public;
revoke all on function public.get_session_agent_counts(text[]) from anon;
grant execute on function public.get_session_agent_counts(text[]) to authenticated;
