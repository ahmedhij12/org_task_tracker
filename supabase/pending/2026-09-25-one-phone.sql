-- 2026-09-25. One phone per account (his rule): signing in on a new phone
-- signs the others out (the app calls signOut({ scope: 'others' })), and
-- every phone keeps asking whether its own sign-in still exists, so the old
-- phone leaves within a minute instead of when its token expires.
create or replace function public.my_session_alive() returns boolean
language sql stable security definer set search_path = public as $$
  -- A token without a session id cannot be checked: never sign anyone out on a guess.
  select case
    when nullif(auth.jwt() ->> 'session_id', '') is null then true
    else exists (
      select 1 from auth.sessions
      where id = (auth.jwt() ->> 'session_id')::uuid and user_id = auth.uid()
    )
  end;
$$;
revoke all on function public.my_session_alive() from public, anon;
grant execute on function public.my_session_alive() to authenticated;
