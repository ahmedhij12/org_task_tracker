-- 2026-09-25. The hygiene auditor role.
--
-- She audits hygiene, verifies checklists, tests oil on a visit, controls the
-- checklist templates and works the monthly report — across ALL branches,
-- like the admin — but has no Branches, Staff or Control panel. Only an
-- admin creates one. Everything she does is recorded for the super admin
-- (watched_admin() already includes this role).
--
-- Additive: nobody holds the role yet, so applying this changes nothing for
-- anyone. Her account is created at release. Functions are re-created from
-- their LIVE definitions (2026-09-25) with only the role check widened.
-- Apply with psql -1.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'team_admin', 'employee', 'hygiene_auditor'));

-- Who reads every branch: the admin and the hygiene auditor.
create or replace function public.sees_all_branches() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner', 'hygiene_auditor'), false);
$$;

-- Every read policy that said "the admin sees everything" now says "the
-- admin or the hygiene auditor". Only the wording of that one test changes.
do $$
declare r record; v_new text;
begin
  for r in
    select c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) as qual
    from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relnamespace = 'public'::regnamespace and p.polcmd = 'r'
      and c.relname in ('checklist_answers', 'checklist_section_photos', 'chicken_marinations', 'form_answers',
                        'oil_fryers', 'oil_tests', 'period_adjustments', 'points_adjustments', 'report_periods',
                        'task_completions', 'task_occurrences', 'tasks')
      and pg_get_expr(p.polqual, p.polrelid) like '%my_role() = ''owner''::text%'
  loop
    v_new := replace(r.qual, '(my_role() = ''owner''::text)', 'sees_all_branches()');
    execute format('alter policy %I on public.%I using (%s)', r.polname, r.relname, v_new);
  end loop;
end $$;

-- She creates her own audit task (the dashboard's Daily Hygiene Checklist card).
do $$
declare v_check text;
begin
  select pg_get_expr(p.polwithcheck, p.polrelid) into v_check
  from pg_policy p where p.polrelid = 'public.tasks'::regclass and p.polname = 'team admin or owner can create tasks for their own team';
  execute format('alter policy %I on public.tasks with check ((%s) or (org_id = my_org_id() and my_role() = %L and is_audit and assignee_id = auth.uid()))',
    'team admin or owner can create tasks for their own team', v_check, 'hygiene_auditor');
end $$;

CREATE OR REPLACE FUNCTION public.adjust_completion_points(p_completion_id uuid, p_new_points numeric, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_completion public.task_completions;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  select * into v_completion from public.task_completions where id = p_completion_id;
  if v_completion.id is null or v_completion.org_id is distinct from v_caller_org then
    raise exception 'not found';
  end if;
  if v_completion.subject_profile_id = v_completion.actor_id then
    raise exception 'this completion has no audit subject — nothing to adjust';
  end if;
  -- Money is the admin's alone: branch managers and supervisors only view.
  if coalesce(v_caller_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only the admin can adjust audit points';
  end if;

  insert into public.points_adjustments (task_completion_id, previous_points, new_points, adjusted_by, reason)
  values (p_completion_id, v_completion.points_awarded, p_new_points, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));

  update public.task_completions set points_awarded = p_new_points where id = p_completion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_period_points(p_period_id uuid, p_subject_profile_id uuid, p_new_points numeric, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_org_id uuid;
  v_period_org_id uuid;
  v_previous numeric;
  v_previous_iqd numeric;
  v_rate numeric;
begin
  select p.role, p.org_id into v_role, v_org_id
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only the org owner can adjust a period''s totals';
  end if;

  select org_id into v_period_org_id from public.report_periods where id = p_period_id;
  if v_period_org_id is distinct from v_org_id then
    raise exception 'that report period does not belong to your organization';
  end if;

  select coalesce(
    (select pa.new_points from public.period_adjustments pa
     where pa.period_id = p_period_id and pa.subject_profile_id = p_subject_profile_id
     order by pa.created_at desc limit 1),
    (select sum(tc.points_awarded) from public.task_completions tc, public.report_periods rp
     where rp.id = p_period_id and tc.org_id = v_org_id and tc.subject_profile_id = p_subject_profile_id
       and tc.points_awarded is not null
       and (tc.created_at at time zone 'Asia/Baghdad') >= rp.period_month
       and (tc.created_at at time zone 'Asia/Baghdad') < (rp.period_month + interval '1 month'))
  ) into v_previous;

  select coalesce(
    (select pa.new_points * pa.iqd_per_point from public.period_adjustments pa
     where pa.period_id = p_period_id and pa.subject_profile_id = p_subject_profile_id
     order by pa.created_at desc limit 1),
    (select sum(tc.points_awarded * tc.iqd_per_point) from public.task_completions tc, public.report_periods rp
     where rp.id = p_period_id and tc.org_id = v_org_id and tc.subject_profile_id = p_subject_profile_id
       and tc.points_awarded is not null
       and (tc.created_at at time zone 'Asia/Baghdad') >= rp.period_month
       and (tc.created_at at time zone 'Asia/Baghdad') < (rp.period_month + interval '1 month'))
  ) into v_previous_iqd;

  select iqd_per_point into v_rate from public.organizations where id = v_org_id;

  insert into public.period_adjustments (period_id, subject_profile_id, previous_points, new_points, iqd_per_point, previous_iqd, adjusted_by, reason)
  values (p_period_id, p_subject_profile_id, v_previous, p_new_points, v_rate, v_previous_iqd, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''));
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_next_month()
 RETURNS TABLE(period_id uuid, period_month date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_role text;
  v_org_created_month date;
  v_last_closed date;
  v_next_month date;
  v_new_period_id uuid;
begin
  select p.org_id, p.role into v_org_id, v_role
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only the org owner can close a month';
  end if;

  select date_trunc('month', o.created_at at time zone 'Asia/Baghdad')::date into v_org_created_month
  from public.organizations o where o.id = v_org_id;

  select max(rp.period_month) into v_last_closed
  from public.report_periods rp where rp.org_id = v_org_id;

  v_next_month := coalesce((v_last_closed + interval '1 month')::date, v_org_created_month);

  if v_next_month + interval '1 month' > (now() at time zone 'Asia/Baghdad') then
    return;
  end if;

  insert into public.report_periods (org_id, period_month, closed_by)
  values (v_org_id, v_next_month, auth.uid())
  returning id into v_new_period_id;

  return query select v_new_period_id, v_next_month;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_branch_summary()
 RETURNS TABLE(branch_id uuid, branch_name text, brand_id uuid, brand_name text, subject_profile_id uuid, subject_name text, total_points numeric, iqd_amount numeric, score_sum numeric, score_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select
    t.id,
    t.name,
    b.id,
    b.name,
    tc.subject_profile_id,
    sp.name,
    sum(tc.points_awarded),
    sum(tc.points_awarded * tc.iqd_per_point),
    sum(tc.score),
    count(tc.score)::int
  from public.task_completions tc
  join public.profiles sp on sp.id = tc.subject_profile_id
  join public.profile_teams pt on pt.profile_id = tc.subject_profile_id
  join public.teams t on t.id = pt.team_id
  left join public.brands b on b.id = pt.brand_id
  where tc.org_id = v_org_id
    and tc.points_awarded is not null
    and (tc.created_at at time zone 'Asia/Baghdad') >= v_month_start
  group by t.id, t.name, b.id, b.name, tc.subject_profile_id, sp.name
  order by t.name, b.name nulls last, sp.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_period_report(p_period_id uuid)
 RETURNS TABLE(branch_id uuid, branch_name text, brand_id uuid, brand_name text, subject_profile_id uuid, subject_name text, total_points numeric, iqd_amount numeric, raw_points numeric, raw_iqd_amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select
    t.id,
    t.name,
    b.id,
    b.name,
    tc.subject_profile_id,
    sp.name,
    coalesce(pa.new_points, sum(tc.points_awarded)),
    coalesce(pa.new_points * pa.iqd_per_point, sum(tc.points_awarded * tc.iqd_per_point)),
    sum(tc.points_awarded),
    sum(tc.points_awarded * tc.iqd_per_point)
  from public.task_completions tc
  join public.profiles sp on sp.id = tc.subject_profile_id
  join public.profile_teams pt on pt.profile_id = tc.subject_profile_id
  join public.teams t on t.id = pt.team_id
  left join public.brands b on b.id = pt.brand_id
  left join lateral (
    select pa2.new_points, pa2.iqd_per_point from public.period_adjustments pa2
    where pa2.period_id = p_period_id and pa2.subject_profile_id = tc.subject_profile_id
    order by pa2.created_at desc
    limit 1
  ) pa on true
  where tc.org_id = v_org_id
    and tc.points_awarded is not null
    and (tc.created_at at time zone 'Asia/Baghdad') >= v_month
    and (tc.created_at at time zone 'Asia/Baghdad') < (v_month + interval '1 month')
  group by t.id, t.name, b.id, b.name, tc.subject_profile_id, sp.name, pa.new_points, pa.iqd_per_point
  order by t.name, b.name nulls last, sp.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_supervisor_streaks()
 RETURNS TABLE(subject_profile_id uuid, negative_streak integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  v_org_id uuid;
begin
  select p.role, p.org_id into v_role, v_org_id from public.profiles p where p.id = auth.uid();
  if coalesce(v_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only the org owner can view performance trends';
  end if;

  return query
  with month_defs as (
    select 0 as rnk, date_trunc('month', now() at time zone 'Asia/Baghdad')::date as month_start, null::uuid as period_id
    union all
    select (row_number() over (order by rp.period_month desc))::int, rp.period_month, rp.id
    from public.report_periods rp where rp.org_id = v_org_id
  ),
  subjects as (
    select distinct tc.subject_profile_id
    from public.task_completions tc
    where tc.org_id = v_org_id and tc.points_awarded is not null
  ),
  grid as (
    select s.subject_profile_id, md.rnk, md.month_start, md.period_id
    from subjects s cross join month_defs md
  ),
  totals as (
    select
      g.subject_profile_id,
      g.rnk,
      count(tc.id) as n,
      coalesce(pa.new_points, sum(tc.points_awarded)) as total
    from grid g
    left join public.task_completions tc
      on tc.org_id = v_org_id
      and tc.subject_profile_id = g.subject_profile_id
      and tc.points_awarded is not null
      and (tc.created_at at time zone 'Asia/Baghdad') >= g.month_start
      and (tc.created_at at time zone 'Asia/Baghdad') < (g.month_start + interval '1 month')
    left join lateral (
      select pa2.new_points from public.period_adjustments pa2
      where pa2.period_id = g.period_id and pa2.subject_profile_id = g.subject_profile_id
      order by pa2.created_at desc limit 1
    ) pa on true
    group by g.subject_profile_id, g.rnk, pa.new_points
  ),
  flagged as (
    select totals.subject_profile_id, totals.rnk, (totals.n > 0 and totals.total < 0) as ok
    from totals
  ),
  first_fail as (
    select flagged.subject_profile_id, min(flagged.rnk) as fail_rnk
    from flagged
    where not flagged.ok
    group by flagged.subject_profile_id
  )
  select s.subject_profile_id, coalesce(ff.fail_rnk, (select max(month_defs.rnk) + 1 from month_defs))
  from subjects s
  left join first_fail ff on ff.subject_profile_id = s.subject_profile_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_checklist_template(p_name text, p_requires_note_on_no boolean, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_template_id uuid;
  v_item jsonb;
  v_i int := 0;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_caller_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only the admin can create a checklist template';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a checklist name is required';
  end if;
  if jsonb_array_length(p_items) < 1 then
    raise exception 'a checklist needs at least one question';
  end if;

  insert into public.checklist_templates (org_id, name, requires_note_on_no, created_by)
  values (v_caller_org, trim(p_name), p_requires_note_on_no, auth.uid())
  returning id into v_template_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.checklist_template_items (template_id, section_title, sort_order, question)
    values (
      v_template_id,
      coalesce(v_item ->> 'section_title', ''),
      v_i,
      v_item ->> 'question'
    );
    v_i := v_i + 1;
  end loop;

  return v_template_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_checklist_template(p_template_id uuid, p_name text, p_requires_note_on_no boolean, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_template_org uuid;
  v_item jsonb;
  v_i int := 0;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_caller_role, '') not in ('owner', 'hygiene_auditor') then
    raise exception 'only an admin can edit a checklist template';
  end if;

  select org_id into v_template_org from public.checklist_templates where id = p_template_id;
  if v_template_org is null then
    raise exception 'checklist template not found';
  end if;
  if v_template_org <> v_caller_org then
    raise exception 'that checklist template does not belong to your organization';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'a checklist name is required';
  end if;
  if jsonb_array_length(p_items) < 1 then
    raise exception 'a checklist needs at least one question';
  end if;

  update public.checklist_templates
  set name = trim(p_name), requires_note_on_no = p_requires_note_on_no
  where id = p_template_id;

  delete from public.checklist_template_items where template_id = p_template_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.checklist_template_items (template_id, section_title, sort_order, question, point_weight)
    values (
      p_template_id,
      coalesce(v_item ->> 'section_title', ''),
      v_i,
      v_item ->> 'question',
      coalesce((v_item ->> 'point_weight')::numeric, 0.25)
    );
    v_i := v_i + 1;
  end loop;

  -- Keep any mirroring template (the supervisors' daily copy) asking the
  -- same questions.
  perform public.sync_mirrored_templates(p_template_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_task_completion(p_task_id uuid, p_completed boolean, p_note text DEFAULT NULL::text, p_photo_urls text[] DEFAULT '{}'::text[], p_answers jsonb DEFAULT NULL::jsonb, p_section_photos jsonb DEFAULT '[]'::jsonb, p_subject_profile_id uuid DEFAULT NULL::uuid, p_shift text DEFAULT NULL::text, p_points numeric DEFAULT NULL::numeric, p_occurrence_id uuid DEFAULT NULL::uuid, p_form_values jsonb DEFAULT NULL::jsonb, p_signature_url text DEFAULT NULL::text, p_location jsonb DEFAULT NULL::jsonb, p_selfie_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task public.tasks;
  v_template public.checklist_templates;
  v_occurrence public.task_occurrences;
  v_my_profile_id uuid := auth.uid();
  v_my_teams uuid[];
  v_my_role text;
  v_photos text[] := coalesce(p_photo_urls, '{}');
  v_was_late boolean := false;
  v_completion_id uuid;
  v_answer jsonb;
  v_photo jsonb;
  v_yes int;
  v_no int;
  v_score numeric;
  v_field public.form_template_fields;
  v_value jsonb;
  v_provided_field_ids uuid[];
  v_subject_id uuid;
  v_shift text;
  v_points numeric;
  v_signature_url text;
begin
  select p.role into v_my_role from public.profiles p where p.id = v_my_profile_id;
  v_my_teams := public.my_team_ids();

  select * into v_task from public.tasks where id = p_task_id;

  if v_task.id is null then
    raise exception 'task not found';
  end if;
  -- The owner is not on a team but still oversees every task in the org. A
  -- multi-team employee can complete a task on any team she belongs to.
  if v_my_role not in ('owner', 'hygiene_auditor') and not (v_task.team_id = any(v_my_teams)) then
    raise exception 'not your team''s task';
  end if;
  if v_task.assignee_id is not null
     and v_task.assignee_id is distinct from v_my_profile_id
     and v_my_role = 'employee' then
    raise exception 'this task is not assigned to you';
  end if;

  -- A scheduled task can only ever be completed against a specific,
  -- still-open occurrence of itself — reopening doesn't need one, since
  -- clearing a stale completion isn't "doing" any particular time slot.
  if v_task.scheduled_times is not null and p_completed then
    if p_occurrence_id is null then
      raise exception 'this task has fixed times — which one is this for?';
    end if;
    select * into v_occurrence from public.task_occurrences where id = p_occurrence_id;
    if v_occurrence.id is null or v_occurrence.task_id is distinct from v_task.id then
      raise exception 'occurrence not found for this task';
    end if;
    if v_occurrence.completion_id is not null then
      raise exception 'this occurrence has already been completed';
    end if;
  end if;

  -- An audit task always names a subject different from the actor, decided
  -- fresh at each submission — never trust p_subject_profile_id on anything
  -- else, and always fall back to "the actor did their own work" instead.
  -- Reopening isn't an audit event even on an is_audit task (nobody is being
  -- judged by clearing a stale completion), so it falls back the same way.
  v_subject_id := v_my_profile_id;
  if v_task.is_audit and p_completed then
    if v_my_role = 'employee' then
      raise exception 'only an admin or team leader can submit an audit';
    end if;
    if p_subject_profile_id is null then
      raise exception 'an audit needs a subject — who was this visit about?';
    end if;
    if p_subject_profile_id = v_my_profile_id then
      raise exception 'you cannot audit yourself';
    end if;
    if not exists (
      select 1 from public.profiles where id = p_subject_profile_id and org_id = v_task.org_id
    ) then
      raise exception 'subject not found in this organization';
    end if;
    v_subject_id := p_subject_profile_id;
    v_shift := p_shift;
    -- Fallback for an audit with no checklist template at all — there's no
    -- structured answer data to compute a penalty from, so the auditor's
    -- own direct judgment is trusted here, same as always. A template-
    -- based audit overwrites this unconditionally below (see the scoring
    -- block), ignoring whatever was passed here.
    v_points := p_points;
    v_signature_url := p_signature_url;
  end if;

  -- Enforced here and not only in the UI: a task that requires proof cannot
  -- be closed without at least one photo, no matter what calls this.
  if p_completed and v_task.requires_proof and coalesce(array_length(v_photos, 1), 0) < 1 then
    raise exception 'this task needs at least one photo before it can be marked done';
  end if;

  if p_completed and v_task.template_id is not null then
    select * into v_template from public.checklist_templates where id = v_task.template_id;
    if p_answers is null or jsonb_array_length(p_answers) < 1 then
      raise exception 'at least one answer is required';
    end if;
    -- N/A exists only for an auditor (a question may not apply at a given
    -- brand); anyone filling their own checklist answers every one Yes or No.
    if not v_task.is_audit and exists (
      select 1 from jsonb_array_elements(p_answers) a where (a ->> 'answer') is null
    ) then
      raise exception 'answer every question with Yes or No';
    end if;
    -- Proof the supervisor was really there, enforced here not just in the UI.
    if v_template.assign_to_role is not null and not v_task.is_audit then
      if coalesce(trim(p_selfie_url), '') = '' then
        raise exception 'a selfie is required to submit this checklist';
      end if;
      if (p_location ->> 'lat') is null or (p_location ->> 'lng') is null then
        raise exception 'your location is required to submit this checklist';
      end if;
      -- Signed like an audit: the supervisor/manager signs their own checklist.
      if coalesce(trim(p_signature_url), '') = '' then
        raise exception 'a signature is required to submit this checklist';
      end if;
      v_signature_url := p_signature_url;
    end if;
    -- Enforced here, not just in the UI: a "لا" answer needs its note
    -- whenever the template requires one, and the check can't be skipped by
    -- the client.
    if v_template.requires_note_on_no then
      for v_answer in select * from jsonb_array_elements(p_answers)
      loop
        if (v_answer ->> 'answer')::boolean = false
           and coalesce(trim(v_answer ->> 'note'), '') = '' then
          raise exception 'a note is required to explain a "لا" answer';
        end if;
      end loop;
    end if;
    select
      count(*) filter (where (a ->> 'answer')::boolean = true),
      count(*) filter (where (a ->> 'answer')::boolean = false)
    into v_yes, v_no
    from jsonb_array_elements(p_answers) a;

    -- The penalty is computed here, not taken from the client (p_points is
    -- deprecated — see its declaration above): sum each "No" answer's own
    -- question's point_weight (0 for "Yes" and for N/A — a null answer must
    -- fall to the else-0 branch, not the point_weight one: "is false" is
    -- the only test that's true for false and false for both true AND
    -- null, unlike a plain boolean check where "when null" never matches
    -- and silently falls through to the penalty branch instead). Matched
    -- by question text + section, the same identity checklist_answers
    -- already snapshots by — there's no item id round-trip through the
    -- client today.
    if v_task.is_audit then
      select coalesce(sum(
        case when (a ->> 'answer')::boolean is false then (
          select it.point_weight from public.checklist_template_items it
          where it.template_id = v_task.template_id
            and it.question = (a ->> 'question')
            and it.section_title = coalesce(a ->> 'section_title', '')
        ) else 0 end
      ), 0) * -1
      into v_points
      from jsonb_array_elements(p_answers) a;

      -- Score out of 100 — see task_completions.score.
      select case
        when sum(w) filter (where ans is not null) > 0
          then round(100 * coalesce(sum(w) filter (where ans), 0) / sum(w) filter (where ans is not null), 1)
        when count(*) filter (where ans is not null) > 0
          then round(100.0 * count(*) filter (where ans) / count(*) filter (where ans is not null), 1)
      end
      into v_score
      from (
        select (a ->> 'answer')::boolean as ans, coalesce((
          select it.point_weight from public.checklist_template_items it
          where it.template_id = v_task.template_id
            and it.question = (a ->> 'question')
            and it.section_title = coalesce(a ->> 'section_title', '')
        ), 0) as w
        from jsonb_array_elements(p_answers) a
      ) scored;
    end if;
  end if;

  -- Every required field on the template must actually be present and
  -- non-empty in the submission — enforced here, not just in the UI, same
  -- as the checklist's note-on-لا rule above.
  if p_completed and v_task.form_template_id is not null then
    if p_form_values is null or jsonb_array_length(p_form_values) < 1 then
      raise exception 'at least one field value is required';
    end if;
    select array_agg((v ->> 'field_id')::uuid) into v_provided_field_ids
    from jsonb_array_elements(p_form_values) v;
    for v_field in
      select * from public.form_template_fields where template_id = v_task.form_template_id
    loop
      if v_field.required and not (v_field.id = any(coalesce(v_provided_field_ids, '{}'))) then
        raise exception 'the field "%" is required', v_field.label;
      end if;
    end loop;
    for v_value in select * from jsonb_array_elements(p_form_values)
    loop
      if coalesce(trim(v_value ->> 'value'), '') = '' and exists (
        select 1 from public.form_template_fields f
        where f.id = (v_value ->> 'field_id')::uuid and f.required
      ) then
        raise exception 'a value is required for every required field';
      end if;
    end loop;
  end if;

  if p_completed then
    -- due_at/was_late always mean "against what deadline" — for a scheduled
    -- task that's the occurrence's own time, not tasks.due (which a
    -- scheduled_times task never sets; the two are mutually exclusive in
    -- spirit even though the column itself allows it).
    if v_occurrence.id is not null then
      v_was_late := now() > v_occurrence.scheduled_for;
    else
      v_was_late := v_task.due is not null and now() > v_task.due;
    end if;
  end if;

  update public.tasks
  set completed = p_completed,
      completed_by = case when p_completed then v_my_profile_id else null end,
      completed_at = case when p_completed then now() else null end,
      proof_note = case when p_completed then p_note else null end,
      proof_photo_urls = case when p_completed then v_photos else '{}' end
  where id = p_task_id;

  -- Every open and close is recorded, so reopening a task never erases the
  -- fact that it was completed, by whom, or with what proof. reviewed_by
  -- starts null on a 'completed' row and stays null forever unless the task
  -- requires review — the "needs review" list filters on exactly that, so a
  -- task that never needed review is simply never in it.
  insert into public.task_completions (
    task_id, org_id, team_id, task_title, actor_id, action,
    note, photo_urls, due_at, was_late, yes_count, no_count,
    subject_profile_id, shift, points_awarded, signature_url, score,
    signed_lat, signed_lng, signed_accuracy_m, signed_address, selfie_url
  ) values (
    v_task.id, v_task.org_id, v_task.team_id, v_task.title, v_my_profile_id,
    case when p_completed then 'completed' else 'reopened' end,
    case when p_completed then p_note else null end,
    case when p_completed then v_photos else '{}' end,
    coalesce(v_occurrence.scheduled_for, v_task.due),
    v_was_late,
    case when p_completed then v_yes else null end,
    case when p_completed then v_no else null end,
    v_subject_id, v_shift, v_points, v_signature_url, v_score,
    case when p_completed then (p_location ->> 'lat')::double precision end,
    case when p_completed then (p_location ->> 'lng')::double precision end,
    case when p_completed then (p_location ->> 'accuracy')::double precision end,
    case when p_completed then left(nullif(trim(p_location ->> 'address'), ''), 300) end,
    case when p_completed and v_task.template_id is not null then nullif(trim(p_selfie_url), '') end
  )
  returning id into v_completion_id;

  if v_occurrence.id is not null then
    update public.task_occurrences set completion_id = v_completion_id where id = v_occurrence.id;
  end if;

  if p_completed and v_task.template_id is not null then
    for v_answer in select * from jsonb_array_elements(p_answers)
    loop
      insert into public.checklist_answers (task_completion_id, section_title, question, sort_order, answer, note)
      values (
        v_completion_id,
        coalesce(v_answer ->> 'section_title', ''),
        v_answer ->> 'question',
        coalesce((v_answer ->> 'sort_order')::int, 0),
        (v_answer ->> 'answer')::boolean,
        nullif(trim(coalesce(v_answer ->> 'note', '')), '')
      );
    end loop;

    for v_photo in select * from jsonb_array_elements(coalesce(p_section_photos, '[]'))
    loop
      insert into public.checklist_section_photos (task_completion_id, section_title, photo_url)
      values (v_completion_id, coalesce(v_photo ->> 'section_title', ''), v_photo ->> 'photo_url');
    end loop;
  end if;

  if p_completed and v_task.form_template_id is not null then
    for v_value in select * from jsonb_array_elements(p_form_values)
    loop
      select * into v_field from public.form_template_fields where id = (v_value ->> 'field_id')::uuid;
      insert into public.form_answers (task_completion_id, field_id, label, sort_order, value)
      values (v_completion_id, v_field.id, v_field.label, v_field.sort_order, nullif(trim(coalesce(v_value ->> 'value', '')), ''));
    end loop;
  end if;

  return v_completion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_off_duty(p_completion_id uuid, p_approve boolean, p_review_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_completion public.task_completions;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select * into v_completion from public.task_completions where id = p_completion_id;
  if v_completion.id is null or v_completion.org_id is distinct from v_caller_org then
    raise exception 'not found';
  end if;
  if v_completion.action <> 'off_duty' or v_completion.status <> 'off_duty_pending' then
    raise exception 'this off-duty claim has already been reviewed';
  end if;
  if not (
    v_caller_role in ('owner', 'hygiene_auditor')
    or (v_caller_role = 'team_admin' and v_completion.team_id = any(v_caller_teams))
  ) then
    raise exception 'only an admin or the team''s leader can review this';
  end if;
  if v_caller_role = 'team_admin' and v_completion.actor_id = auth.uid() then
    raise exception 'your own checklist is verified by the admin';
  end if;

  update public.task_completions
  set status = case when p_approve then 'off_duty_approved' else 'off_duty_rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = p_completion_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_user(p_name text, p_username text, p_password text, p_role text DEFAULT 'employee'::text, p_team_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text, p_brand_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_org_code text;
  v_new_id uuid := gen_random_uuid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  if v_caller_role is null then
    raise exception 'not authenticated';
  end if;
  if v_caller_role not in ('owner', 'team_admin') then
    raise exception 'only an admin or team leader can create users';
  end if;
  if p_role not in ('employee', 'team_admin', 'owner', 'hygiene_auditor') then
    raise exception 'role must be employee, team_admin, hygiene_auditor, or owner';
  end if;
  -- Only an existing admin may create another admin — never a branch
  -- manager, even though the branch-manager branch below would already
  -- catch this (p_role must be 'employee' there). Kept as its own explicit
  -- check because this is a privilege-escalation boundary, not incidental.
  if p_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'only an admin can create another admin';
  end if;
  -- The hygiene auditor sees every branch: only an admin creates one.
  if p_role = 'hygiene_auditor' and v_caller_role <> 'owner' then
    raise exception 'only an admin can create a hygiene auditor';
  end if;

  if v_caller_role = 'team_admin' then
    if p_role <> 'employee' then
      raise exception 'a branch manager can only create supervisors';
    end if;
    if p_team_id is null or not (p_team_id = any(v_caller_teams)) then
      raise exception 'a branch manager can only create users on their own branch';
    end if;
  end if;

  if p_team_id is not null and not exists (
    select 1 from public.teams t where t.id = p_team_id and t.org_id = v_caller_org
  ) then
    raise exception 'team not found in this organization';
  end if;

  if p_brand_id is not null then
    if p_role <> 'employee' then
      raise exception 'a brand can only be set for a supervisor';
    end if;
    if p_team_id is null or not exists (
      select 1 from public.branch_brands bb where bb.branch_id = p_team_id and bb.brand_id = p_brand_id
    ) then
      raise exception 'that brand does not operate at the chosen branch';
    end if;
  end if;

  if v_username = '' then
    raise exception 'a username is required';
  end if;
  if coalesce(length(p_password), 0) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.org_id = v_caller_org and lower(p.username) = v_username
  ) then
    raise exception 'that username is already taken in this organization';
  end if;

  select o.org_code into v_org_code
  from public.organizations o where o.id = v_caller_org;

  -- Globally unique: org_code is unique across orgs, username is unique
  -- within an org. Never a real mailbox — see recovery_email for that.
  v_email := v_username || '.' || v_org_code || '@users.rungs.internal';

  -- confirmed_at is a generated column and must not be inserted into. The
  -- token columns must be '' rather than NULL: GoTrue scans them into
  -- non-nullable Go strings and errors out on NULL at login.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf', 10)),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  -- GoTrue's password grant checks identities as well as users; without this
  -- row the account exists but cannot sign in.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_new_id::text, v_new_id,
    jsonb_build_object(
      'sub', v_new_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email', now(), now(), now()
  );

  insert into public.profiles (
    id, org_id, name, title, username, role,
    must_change_password, active
  ) values (
    v_new_id, v_caller_org, p_name,
    nullif(trim(coalesce(p_title, '')), ''), v_username, p_role,
    true, true
  );

  if p_team_id is not null then
    insert into public.profile_teams (profile_id, team_id, added_by, brand_id)
    values (v_new_id, p_team_id, auth.uid(), p_brand_id);
  end if;

  return v_new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_oil_test(p_fryer_id uuid, p_tpm numeric, p_temp_c numeric, p_filtered boolean, p_photo_url text, p_signature_url text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_is_audit boolean DEFAULT false, p_late_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_role text; v_teams uuid[]; v_fryer public.oil_fryers;
        v_grade text; v_id uuid; v_slot time; v_late int;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  select * into v_fryer from public.oil_fryers where id = p_fryer_id and org_id = v_org and not archived;
  if v_fryer.id is null then raise exception 'fryer not found'; end if;
  if not (v_role in ('owner', 'hygiene_auditor') or v_fryer.team_id = any(v_teams)) then
    raise exception 'you can only test fryers at your own branch'; end if;
  if p_tpm is null then raise exception 'the TPM reading is required'; end if;
  if coalesce(trim(p_photo_url), '') = '' then raise exception 'a photo of the tester is required'; end if;

  select s.slot_time, s.minutes_late into v_slot, v_late
    from public.oil_slot_for(v_fryer.team_id, now()) s;

  -- An auditor's spot check is never "late"; it is not part of the schedule.
  if p_is_audit then v_slot := null; v_late := null; end if;

  if v_late is not null and coalesce(trim(p_late_reason), '') = '' then
    raise exception 'this test is late — please explain why';
  end if;

  v_grade := case when p_tpm >= 22 then 'change' when p_tpm >= 20 then 'watch' else 'good' end;

  insert into public.oil_tests (org_id, team_id, fryer_id, actor_id, is_audit, tpm, temp_c,
    filtered, grade, photo_url, signature_url, note, slot_time, minutes_late, late_reason)
  values (v_org, v_fryer.team_id, p_fryer_id, auth.uid(), coalesce(p_is_audit, false), p_tpm, p_temp_c,
    coalesce(p_filtered, false), v_grade, p_photo_url, nullif(trim(p_signature_url), ''), nullif(trim(p_note), ''),
    v_slot, v_late, nullif(trim(p_late_reason), ''))
  returning id into v_id;
  return v_id;
end; $function$;
