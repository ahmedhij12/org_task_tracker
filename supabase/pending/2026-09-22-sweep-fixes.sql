-- NOT YET APPLIED to live (2026-09-22). Sweep fixes, built from the live definitions.
-- Mirrors SETUP.sql. Apply as one transaction (psql -1).

CREATE OR REPLACE FUNCTION public.assert_can_manage_user(p_target_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_caller_teams uuid[];
  v_target_org uuid;
  v_target_role text;
  v_target_teams uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();
  v_caller_teams := public.my_team_ids();

  select p.org_id, p.role into v_target_org, v_target_role
  from public.profiles p where p.id = p_target_profile_id;
  select coalesce(array_agg(team_id), '{}') into v_target_teams
  from public.profile_teams where profile_id = p_target_profile_id;

  if v_target_org is null then
    raise exception 'user not found';
  end if;
  if v_target_org is distinct from v_caller_org then
    raise exception 'that user is not in your organization';
  end if;
  if v_caller_role = 'owner' then
    return;
  end if;
  -- A multi-team employee is manageable by any leader she shares a team with.
  -- A branch manager manages the supervisors on their branch, never a peer manager or the owner.
  if v_caller_role = 'team_admin' and v_target_role = 'employee' and v_caller_teams && v_target_teams then
    return;
  end if;
  raise exception 'only an admin or the user''s team leader can manage this account';
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
    v_caller_role = 'owner'
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

  if v_caller_role <> 'owner' then
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

CREATE OR REPLACE FUNCTION public.create_form_template(p_name text, p_fields jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller_role text;
  v_caller_org uuid;
  v_template_id uuid;
  v_field jsonb;
  v_i int := 0;
begin
  select p.role, p.org_id into v_caller_role, v_caller_org
  from public.profiles p where p.id = auth.uid();

  if v_caller_role <> 'owner' then
    raise exception 'only the admin can create a form template';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a form name is required';
  end if;
  if jsonb_array_length(p_fields) < 1 then
    raise exception 'a form needs at least one field';
  end if;

  insert into public.form_templates (org_id, name, created_by)
  values (v_caller_org, trim(p_name), auth.uid())
  returning id into v_template_id;

  for v_field in select * from jsonb_array_elements(p_fields)
  loop
    insert into public.form_template_fields (template_id, sort_order, label, field_type, options, unit, required)
    values (
      v_template_id,
      v_i,
      v_field ->> 'label',
      v_field ->> 'field_type',
      v_field -> 'options',
      v_field ->> 'unit',
      coalesce((v_field ->> 'required')::boolean, true)
    );
    v_i := v_i + 1;
  end loop;

  return v_template_id;
end;
$function$;

-- Live verification for supervisors: push task_completions changes (RLS still applies per subscriber).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_completions') then
    alter publication supabase_realtime add table public.task_completions;
  end if;
end $$;
