-- Simplifies the Organization ID to a plain 5-digit number (e.g. "48213"),
-- no letters. Uniqueness is still enforced the same way as before — the
-- org_code column is UNIQUE, and this function retries on a collision, so
-- two organizations can never end up with the same ID.
--
-- Paste into Supabase Studio -> SQL Editor -> New query -> Run.

create or replace function public.generate_org_code(p_name text)
returns text
language plpgsql
as $$
declare
  candidate text;
  n int := 0;
begin
  loop
    candidate := lpad(floor(random() * 100000)::text, 5, '0');
    exit when not exists (select 1 from public.organizations where org_code = candidate);
    n := n + 1;
    exit when n > 50; -- safety valve; collisions are only likely once tens of thousands of orgs exist
  end loop;
  return candidate;
end;
$$;
