-- 2026-09-25, code review fixes I6 and I8. Apply with psql -1.
--
-- I6  A marination batch keeps the rule it was made under (due time and both
--     graces), frozen on the row like a checklist's score, so changing the
--     control panel never re-grades history. Existing rows are frozen at what
--     was live when they were made: 3 h, 5-min grace each side.
-- I8  The hygiene auditor completes or reopens only her own audit tasks.

alter table public.chicken_marinations add column if not exists due_at timestamptz;
alter table public.chicken_marinations add column if not exists early_grace_min int;
alter table public.chicken_marinations add column if not exists late_grace_min int;
update public.chicken_marinations
   set due_at = marinated_at + interval '3 hours', early_grace_min = 5, late_grace_min = 5
 where due_at is null;

CREATE OR REPLACE FUNCTION public.submit_chicken_marination(p_team_id uuid, p_marinated_at timestamp with time zone, p_count_in numeric, p_unloaded_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_count_out numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_signature_url text DEFAULT NULL::text, p_is_audit boolean DEFAULT false, p_remind boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_role text; v_teams uuid[]; v_id uuid; v_remind timestamptz;
begin
  select org_id, role into v_org, v_role from public.profiles where id = auth.uid();
  v_teams := public.my_team_ids();
  if not exists (select 1 from public.teams where id = p_team_id and org_id = v_org) then
    raise exception 'branch not found'; end if;
  if not (v_role = 'owner' or p_team_id = any(v_teams)) then
    raise exception 'you can only record for your own branch'; end if;
  if p_marinated_at is null then raise exception 'the marination time is required'; end if;

  -- Only worth reminding when the batch is still in (no unload recorded yet).
  if coalesce(p_remind, false) and p_unloaded_at is null then
    v_remind := p_marinated_at + make_interval(mins => round(public.marination_hours_for(v_org) * 60)::int);
  end if;

  -- The rule this batch is graded by is frozen on it, like a checklist's score:
  -- changing the control panel later never re-grades yesterday's batches.
  insert into public.chicken_marinations (org_id, team_id, actor_id, is_audit, marinated_at,
    due_at, early_grace_min, late_grace_min,
    count_in, unloaded_at, count_out, note, signature_url, remind_at)
  values (v_org, p_team_id, auth.uid(), coalesce(p_is_audit, false), p_marinated_at,
    p_marinated_at + make_interval(mins => round(public.marination_hours_for(v_org) * 60)::int),
    (select marination_early_grace_min from public.org_settings where org_id = v_org),
    (select marination_late_grace_min from public.org_settings where org_id = v_org),
    p_count_in, p_unloaded_at, p_count_out, nullif(trim(p_note), ''), nullif(trim(p_signature_url), ''), v_remind)
  returning id into v_id;
  return v_id;
end; $function$;

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
  -- The hygiene auditor audits; she never completes or reopens anyone else's
  -- work (code review 2026-09-25, I8) — only her own audit tasks.
  if v_my_role = 'hygiene_auditor' and not (v_task.is_audit and v_task.assignee_id = v_my_profile_id) then
    raise exception 'a hygiene auditor only completes her own audits';
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
