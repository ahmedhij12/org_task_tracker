-- Diagnostic only. Shows the literal, current definition of the two
-- functions we need to actually read (not just compare hashes of).
select 'get_login_email' as fn, pg_get_functiondef(oid) as definition
from pg_proc
where proname = 'get_login_email' and pronamespace = 'public'::regnamespace
union all
select 'generate_org_code' as fn, pg_get_functiondef(oid) as definition
from pg_proc
where proname = 'generate_org_code' and pronamespace = 'public'::regnamespace;
