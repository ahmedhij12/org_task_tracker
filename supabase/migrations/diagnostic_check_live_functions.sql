-- Diagnostic only — not a migration to keep. Shows exactly which version of
-- each function is currently live in the database, so we can tell what
-- actually got applied vs. what's still pending.
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  md5(pg_get_functiondef(p.oid)) as body_hash
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('generate_org_code', 'get_login_email', 'get_org_by_code', 'create_organization', 'join_organization')
order by p.proname;
