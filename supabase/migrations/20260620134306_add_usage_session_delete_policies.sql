drop policy if exists "usage_sessions_delete_own" on public.usage_sessions;
create policy "usage_sessions_delete_own"
on public.usage_sessions
for delete
using (auth.uid() = user_id);

drop policy if exists "usage_session_agents_delete_own" on public.usage_session_agents;
create policy "usage_session_agents_delete_own"
on public.usage_session_agents
for delete
using (auth.uid() = user_id);
