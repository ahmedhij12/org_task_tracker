-- Late checklists: the auditor decides each one (his design, 2026-09-26).
--
-- A supervisor who sends his checklist after the deadline types why (the
-- completion note). Whoever has the 'excuse_late' switch — the hygiene
-- auditor and the admin by default — then verifies it one of three ways:
--   penalty  : verified, and the late-checklist penalty from the control
--              panel is charged (the amount is stamped here, so changing it
--              later never touches this one)
--   warning  : verified, and he is told the next late one is a penalty
--   none     : verified as usual
-- The decision is the verification: it sets reviewed_by/at like Verify does.
--
-- The penalty is money, not points: the monthly report shows it as its own
-- figure (late_penalty_iqd) beside the audit money, and the person's total is
-- both together. A month adjustment keeps editing audit points only, so a
-- penalty is never counted twice.

alter table public.task_completions
  add column if not exists late_outcome text check (late_outcome in ('penalty', 'warning', 'none')),
  add column if not exists late_penalty_iqd int check (late_penalty_iqd >= 0);

create or replace function public.decide_late_checklist(p_completion_id uuid, p_outcome text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.task_completions; v_amount int; v_tz text;
begin
  if not public.has_permission('excuse_late') then
    raise exception 'you cannot decide a late checklist';
  end if;
  if p_outcome is null or p_outcome not in ('penalty', 'warning', 'none') then
    raise exception 'unknown decision';
  end if;
  select * into v from public.task_completions
   where id = p_completion_id and org_id = public.my_org_id() for update;
  if v.id is null then raise exception 'not found'; end if;
  if v.action <> 'completed' or not v.was_late or v.checklist_slot is null then
    raise exception 'this checklist was not late';
  end if;
  if v.late_outcome is not null then raise exception 'this late checklist was already decided'; end if;
  if v.actor_id = auth.uid() then raise exception 'you cannot decide your own checklist'; end if;
  if p_outcome = 'penalty' then
    select s.late_checklist_penalty_iqd into v_amount from public.org_settings s where s.org_id = v.org_id;
    if coalesce(v_amount, 0) <= 0 then
      raise exception 'set the late checklist penalty in the control panel first';
    end if;
  end if;

  update public.task_completions
     set late_outcome = p_outcome,
         late_penalty_iqd = v_amount,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = coalesce(nullif(trim(p_note), ''), review_note)
   where id = v.id;

  -- A warning is only worth something if he hears it.
  if p_outcome = 'warning' then
    begin
      select coalesce(timezone, 'Asia/Baghdad') into v_tz from public.teams where id = v.team_id;
      perform public.push_to_profiles(array[v.actor_id], 'تنبيه: قائمة فحص متأخرة',
        'قائمة ' || to_char(v.created_at at time zone coalesce(v_tz, 'Asia/Baghdad'), 'DD/MM')
          || ' أُرسلت متأخرة. المرة القادمة ستكون هناك غرامة.',
        'late-warning-' || v.id);
    exception when others then
      raise warning 'late warning push: %', sqlerrm;
    end;
  end if;
end; $$;
revoke all on function public.decide_late_checklist(uuid, text, text) from public, anon;
grant execute on function public.decide_late_checklist(uuid, text, text) to authenticated;

-- ------------------------------------------------------------ the report
-- Both now start from everyone with audit points OR a late penalty that
-- month, so a supervisor with only a penalty still appears. The audit
-- columns are unchanged; late_penalty_iqd is new (a positive amount owed).

drop function if exists public.get_current_branch_summary();
create function public.get_current_branch_summary()
 returns table(branch_id uuid, branch_name text, brand_id uuid, brand_name text, subject_profile_id uuid, subject_name text,
               total_points numeric, iqd_amount numeric, score_sum numeric, score_count integer, late_penalty_iqd numeric)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_role text;
  v_month_start date;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only the org owner can view the branch summary';
  end if;

  v_month_start := date_trunc('month', now() at time zone 'Asia/Baghdad')::date;

  return query
  with a as (
    select tc.subject_profile_id as sid,
           sum(tc.points_awarded) as pts,
           sum(tc.points_awarded * tc.iqd_per_point) as iqd,
           sum(tc.score) as ssum,
           count(tc.score)::int as scnt
      from public.task_completions tc
     where tc.org_id = v_org_id
       and tc.points_awarded is not null
       and (tc.created_at at time zone 'Asia/Baghdad') >= v_month_start
     group by tc.subject_profile_id
  ), l as (
    select tc.subject_profile_id as sid, sum(tc.late_penalty_iqd)::numeric as pen
      from public.task_completions tc
     where tc.org_id = v_org_id
       and tc.late_outcome = 'penalty'
       and (tc.created_at at time zone 'Asia/Baghdad') >= v_month_start
     group by tc.subject_profile_id
  ), s as (
    select a.sid from a union select l.sid from l
  )
  select t.id, t.name, b.id, b.name, s.sid, sp.name,
         coalesce(a.pts, 0), coalesce(a.iqd, 0), a.ssum, coalesce(a.scnt, 0), coalesce(l.pen, 0)
    from s
    join public.profiles sp on sp.id = s.sid
    join public.profile_teams pt on pt.profile_id = s.sid
    join public.teams t on t.id = pt.team_id
    left join public.brands b on b.id = pt.brand_id
    left join a on a.sid = s.sid
    left join l on l.sid = s.sid
   order by t.name, b.name nulls last, sp.name;
end;
$function$;
revoke all on function public.get_current_branch_summary() from public, anon;
grant execute on function public.get_current_branch_summary() to authenticated;

drop function if exists public.get_period_report(uuid);
create function public.get_period_report(p_period_id uuid)
 returns table(branch_id uuid, branch_name text, brand_id uuid, brand_name text, subject_profile_id uuid, subject_name text,
               total_points numeric, iqd_amount numeric, raw_points numeric, raw_iqd_amount numeric, late_penalty_iqd numeric)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_role text;
  v_period_org_id uuid;
  v_month date;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only the org owner can view reports';
  end if;

  select rp.org_id, rp.period_month into v_period_org_id, v_month
  from public.report_periods rp where rp.id = p_period_id;

  if v_period_org_id is distinct from v_org_id then
    raise exception 'that report period does not belong to your organization';
  end if;

  return query
  with a as (
    select tc.subject_profile_id as sid,
           sum(tc.points_awarded) as pts,
           sum(tc.points_awarded * tc.iqd_per_point) as iqd
      from public.task_completions tc
     where tc.org_id = v_org_id
       and tc.points_awarded is not null
       and (tc.created_at at time zone 'Asia/Baghdad') >= v_month
       and (tc.created_at at time zone 'Asia/Baghdad') < (v_month + interval '1 month')
     group by tc.subject_profile_id
  ), l as (
    select tc.subject_profile_id as sid, sum(tc.late_penalty_iqd)::numeric as pen
      from public.task_completions tc
     where tc.org_id = v_org_id
       and tc.late_outcome = 'penalty'
       and (tc.created_at at time zone 'Asia/Baghdad') >= v_month
       and (tc.created_at at time zone 'Asia/Baghdad') < (v_month + interval '1 month')
     group by tc.subject_profile_id
  ), s as (
    select a.sid from a union select l.sid from l
  )
  select t.id, t.name, b.id, b.name, s.sid, sp.name,
         coalesce(pa.new_points, a.pts, 0),
         coalesce(pa.new_points * pa.iqd_per_point, a.iqd, 0),
         coalesce(a.pts, 0),
         coalesce(a.iqd, 0),
         coalesce(l.pen, 0)
    from s
    join public.profiles sp on sp.id = s.sid
    join public.profile_teams pt on pt.profile_id = s.sid
    join public.teams t on t.id = pt.team_id
    left join public.brands b on b.id = pt.brand_id
    left join a on a.sid = s.sid
    left join l on l.sid = s.sid
    left join lateral (
      select pa2.new_points, pa2.iqd_per_point from public.period_adjustments pa2
       where pa2.period_id = p_period_id and pa2.subject_profile_id = s.sid
       order by pa2.created_at desc
       limit 1
    ) pa on true
   order by t.name, b.name nulls last, sp.name;
end;
$function$;
revoke all on function public.get_period_report(uuid) from public, anon;
grant execute on function public.get_period_report(uuid) to authenticated;
