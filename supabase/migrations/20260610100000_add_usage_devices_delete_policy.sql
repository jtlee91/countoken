drop policy if exists "usage_devices_delete_own" on public.usage_devices;
create policy "usage_devices_delete_own"
on public.usage_devices
for delete
using (auth.uid() = user_id);

drop policy if exists "usage_daily_delete_own" on public.usage_daily;
create policy "usage_daily_delete_own"
on public.usage_daily
for delete
using (auth.uid() = user_id);
