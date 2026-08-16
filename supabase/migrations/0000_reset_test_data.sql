-- One-time cleanup: wipes all app data AND test auth accounts, so testing
-- can start from a clean slate. Safe to re-run any time during testing —
-- NOT something to run once real users exist.
--
-- Paste into Supabase Studio -> SQL Editor -> New query -> Run.

truncate table public.tasks, public.teams, public.profiles, public.organizations cascade;
delete from auth.users;
