-- RELEASE STEP — apply together with the release, NOT before (2026-09-25).
-- Each change here is visible to branch managers on the live app the moment
-- it lands, and he wants to check on his phone first.
--
-- 1. A branch manager gets the supervisors' daily checklist beside his own:
--    with one supervisor, he sometimes fills it for him.
-- 2. His oil tests are untimed — never tied to a slot, never late.
-- 3. Verifying a checklist is the admin's and the hygiene auditor's job,
--    no longer the branch manager's.
--
-- Built from the LIVE definitions (2026-09-25). Apply with psql -1.

create or replace function public.ensure_role_checklist_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles;
  v_template public.checklist_templates;
begin
  select * into v_profile from public.profiles where id = new.profile_id;
  for v_template in
    select * from public.checklist_templates
    where org_id = v_profile.org_id and not archived
      and (assign_to_role = v_profile.role
           -- A branch manager also gets the supervisors' checklist.
           or (v_profile.role = 'team_admin' and assign_to_role = 'employee'))
  loop
    if not exists (
      select 1 from public.tasks
      where assignee_id = new.profile_id and team_id = new.team_id and template_id = v_template.id
    ) then
      insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, cooldown_hours, priority, requires_review)
      values (v_profile.org_id, new.team_id, v_template.name, new.profile_id,
              coalesce(new.added_by, v_template.created_by), v_template.id, 0, 'medium', true);
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.set_template_audience(p_template_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_template public.checklist_templates;
begin
  if public.role_of(auth.uid()) is distinct from 'owner' then
    raise exception 'only the org owner can choose who fills a checklist';
  end if;
  select * into v_template from public.checklist_templates where id = p_template_id;
  if v_template.id is null or v_template.org_id is distinct from public.my_org_id() then
    raise exception 'checklist template not found';
  end if;
  if p_role is not null and p_role not in ('employee', 'team_admin') then
    raise exception 'a checklist can be for supervisors or branch managers';
  end if;
  if p_role is not null and exists (select 1 from public.tasks where template_id = p_template_id and is_audit) then
    raise exception 'this is an audit checklist — it stays with the admin';
  end if;

  update public.checklist_templates set assign_to_role = p_role where id = p_template_id;

  -- Keep a task only for the people this checklist is now for — the role
  -- itself, plus branch managers when it is the supervisors' checklist.
  delete from public.tasks t
  where t.template_id = p_template_id and not t.is_audit
    and (p_role is null or not exists (
      select 1 from public.profiles p where p.id = t.assignee_id
        and (p.role = p_role or (p_role = 'employee' and p.role = 'team_admin'))));

  if p_role is not null then
    insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, cooldown_hours, priority, requires_review)
    select p.org_id, pt.team_id, v_template.name, p.id, auth.uid(), p_template_id, 0, 'medium', true
    from public.profile_teams pt
    join public.profiles p on p.id = pt.profile_id
    where p.org_id = v_template.org_id and p.deleted_at is null
      and (p.role = p_role or (p_role = 'employee' and p.role = 'team_admin'))
      and not exists (
        select 1 from public.tasks t where t.assignee_id = p.id and t.team_id = pt.team_id and t.template_id = p_template_id
      );
  end if;
end;
$$;

-- Backfill: every current branch manager gets the supervisors' checklist at
-- each of his branches.
insert into public.tasks (org_id, team_id, title, assignee_id, created_by, template_id, cooldown_hours, priority, requires_review)
select p.org_id, pt.team_id, ct.name, p.id, ct.created_by, ct.id, 0, 'medium', true
from public.profiles p
join public.profile_teams pt on pt.profile_id = p.id
join public.checklist_templates ct on ct.org_id = p.org_id and ct.assign_to_role = 'employee' and not ct.archived
where p.role = 'team_admin' and p.deleted_at is null
  and not exists (
    select 1 from public.tasks t where t.assignee_id = p.id and t.team_id = pt.team_id and t.template_id = ct.id
  );

create or replace function public.review_task_completion(p_completion_id uuid, p_review_note text default null)
returns void language plpgsql security definer set search_path = public as $$
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
  if v_completion.action <> 'completed' then
    raise exception 'only a completed task can be reviewed this way';
  end if;
  -- The admin and the hygiene auditor verify; the branch manager no longer does.
  if v_caller_role not in ('owner', 'hygiene_auditor') then
    raise exception 'only an admin or the hygiene auditor can verify a checklist';
  end if;

  update public.task_completions
  set reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = p_completion_id;
end;
$$;

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
  if not (v_role = 'owner' or v_fryer.team_id = any(v_teams)) then
    raise exception 'you can only test fryers at your own branch'; end if;
  if p_tpm is null then raise exception 'the TPM reading is required'; end if;
  if coalesce(trim(p_photo_url), '') = '' then raise exception 'a photo of the tester is required'; end if;

  select s.slot_time, s.minutes_late into v_slot, v_late
    from public.oil_slot_for(v_fryer.team_id, now()) s;

  -- An auditor's spot check is never "late"; it is not part of the schedule.
  -- Nor is a branch manager's: he tests any time, outside the supervisors'
  -- slots, so his test neither closes a slot nor runs late (2026-09-25).
  if p_is_audit or v_role = 'team_admin' then v_slot := null; v_late := null; end if;

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
