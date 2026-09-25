-- Proves set_branch_radius's guards against the LIVE data, then rolls back,
-- so nothing it does persists. Run it with psql -f (see the plan's Global
-- Constraints for the connection). Success = only "PASS:" notices, then ROLLBACK.
begin;

-- Become a real user of org 51880 for the rest of the transaction.
create function pg_temp.as_user(p_username text) returns void language plpgsql as $$
declare v_id uuid;
begin
  select p.id into v_id
  from public.profiles p join public.organizations o on o.id = p.org_id
  where p.username = p_username and o.org_code = '51880';
  if v_id is null then raise exception 'FAIL: no profile %', p_username; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end; $$;

do $$
declare
  v_org uuid;
  v_baghdad uuid;
  v_n int;
  v_before_other_orgs text;
begin
  -- 1. A supervisor is refused.
  perform pg_temp.as_user('ob12');
  begin
    perform public.set_branch_radius(null, 30);
    raise exception 'FAIL: a supervisor changed the check-in distance';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: supervisor refused (%)', sqlerrm;
  end;

  perform pg_temp.as_user('hijazi12');
  select org_id into v_org from public.profiles where id = auth.uid();
  select id into v_baghdad from public.teams where org_id = v_org and name = 'Baghdad';
  if v_baghdad is null then raise exception 'FAIL: Baghdad branch not found'; end if;
  select coalesce(string_agg(id::text || '=' || radius_m, ',' order by id), '')
    into v_before_other_orgs from public.teams where org_id <> v_org;

  -- 2. Out of range is refused, both ends.
  begin
    perform public.set_branch_radius(null, 4);
    raise exception 'FAIL: 4 m was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: 4 m refused (%)', sqlerrm;
  end;
  begin
    perform public.set_branch_radius(null, 2001);
    raise exception 'FAIL: 2001 m was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: 2001 m refused (%)', sqlerrm;
  end;

  -- 3. An unknown branch is refused.
  begin
    perform public.set_branch_radius(gen_random_uuid(), 30);
    raise exception 'FAIL: an unknown branch was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: unknown branch refused (%)', sqlerrm;
  end;

  -- 4. One branch changes, and only that branch. 1237 is a value no real branch has.
  v_n := public.set_branch_radius(v_baghdad, 1237);
  if v_n <> 1 then raise exception 'FAIL: one branch should change, got %', v_n; end if;
  if (select radius_m from public.teams where id = v_baghdad) <> 1237 then
    raise exception 'FAIL: Baghdad did not change';
  end if;
  if exists (select 1 from public.teams where org_id = v_org and id <> v_baghdad and radius_m = 1237) then
    raise exception 'FAIL: another branch changed too';
  end if;
  raise notice 'PASS: one branch changed alone';

  -- 5. "Set all" changes every branch in the org and nothing outside it.
  v_n := public.set_branch_radius(null, 1238);
  if v_n <> (select count(*) from public.teams where org_id = v_org) then
    raise exception 'FAIL: set all changed % branches', v_n;
  end if;
  if exists (select 1 from public.teams where org_id = v_org and radius_m <> 1238) then
    raise exception 'FAIL: set all missed a branch';
  end if;
  if v_before_other_orgs <> (select coalesce(string_agg(id::text || '=' || radius_m, ',' order by id), '')
                             from public.teams where org_id <> v_org) then
    raise exception 'FAIL: set all reached another organisation';
  end if;
  raise notice 'PASS: set all changed every branch of this org only';

  -- 6. The pin itself never moves.
  if exists (select 1 from public.teams where id = v_baghdad and lat is null) then
    raise exception 'FAIL: the pin was cleared';
  end if;
  raise notice 'PASS: pin untouched';
end $$;

rollback;
