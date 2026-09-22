-- NOT YET APPLIED to live (2026-09-22). Web-push subscriptions.
-- One row per browser that opted in (the Home-Screen web app on iPhone, or a
-- desktop/Android browser). Mirrored into SETUP.sql. Apply with psql -1.

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists web_push_profile_idx on public.web_push_subscriptions(profile_id);

alter table public.web_push_subscriptions enable row level security;

drop policy if exists "own web push" on public.web_push_subscriptions;
create policy "own web push" on public.web_push_subscriptions for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Upsert the current browser's subscription for the signed-in user.
create or replace function public.save_web_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.profiles where id = auth.uid();
  if v_org is null then raise exception 'not signed in'; end if;
  insert into public.web_push_subscriptions (profile_id, org_id, endpoint, p256dh, auth)
  values (auth.uid(), v_org, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set profile_id = excluded.profile_id, org_id = excluded.org_id,
    p256dh = excluded.p256dh, auth = excluded.auth;
end; $$;

create or replace function public.delete_web_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.web_push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid();
end; $$;

grant execute on function public.save_web_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_web_push_subscription(text) to authenticated;
