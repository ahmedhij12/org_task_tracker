-- NOT YET APPLIED to live (2026-09-22). Push a notification to the branch's
-- admin + managers when a red (change-the-oil) test is saved.
-- The bd-push bearer token is inserted SEPARATELY (never in git) into
-- app_secrets. Mirrored into SETUP.sql (minus the token). Apply with psql -1.

create extension if not exists pg_net;

-- Private key/value store. RLS on with no policy = unreachable except from the
-- SECURITY DEFINER trigger below.
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;

create or replace function public.notify_red_oil()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_fryer text;
  v_branch text;
  v_subs jsonb;
begin
  if new.grade <> 'change' then return new; end if;
  select value into v_token from public.app_secrets where key = 'push_token';
  if v_token is null then return new; end if;

  select name into v_fryer from public.oil_fryers where id = new.fryer_id;
  select name into v_branch from public.teams where id = new.team_id;

  -- The org owner, plus the managers of this branch.
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into v_subs
  from public.web_push_subscriptions s
  join public.profiles p on p.id = s.profile_id
  where s.org_id = new.org_id
    and (
      p.role = 'owner'
      or (p.role = 'team_admin' and exists (
        select 1 from public.profile_teams pt where pt.profile_id = p.id and pt.team_id = new.team_id))
    );

  if jsonb_array_length(v_subs) = 0 then return new; end if;

  perform net.http_post(
    url := 'https://bd-push.ahmedhijazi09.workers.dev',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    body := jsonb_build_object(
      'subscriptions', v_subs,
      'title', 'BD Audit — oil needs changing',
      'body', coalesce(v_branch, '') || ' · ' || coalesce(v_fryer, '') || ' · ' || new.tpm || '% TPM',
      'url', 'https://bdaudit.hijazionline.com/history',
      'tag', 'oil-' || new.fryer_id
    )
  );
  return new;
end; $$;

drop trigger if exists red_oil_push on public.oil_tests;
create trigger red_oil_push after insert on public.oil_tests
  for each row execute function public.notify_red_oil();
