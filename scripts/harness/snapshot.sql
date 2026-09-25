-- Read-only: the rows the harness serves instead of the live database.
-- ./scripts/harness/snapshot.sh writes them to .dev-session/ (gitignored —
-- real names; never commit it).
select json_build_object(
 'profiles', (select json_agg(p) from profiles p),
 'teams', (select json_agg(t) from teams t),
 'profile_teams', (select json_agg(x) from profile_teams x),
 'organizations', (select json_agg(o) from organizations o),
 'org_settings', (select json_agg(x) from org_settings x),
 'tasks', (select json_agg(x) from tasks x),
 'task_completions', (select json_agg(x) from (select * from task_completions order by created_at desc limit 80) x),
 'checklist_templates', (select json_agg(x) from checklist_templates x),
 'checklist_template_items', (select json_agg(x) from checklist_template_items x),
 'oil_slots', (select json_agg(x) from oil_slots x),
 'oil_fryers', (select json_agg(x) from oil_fryers x),
 'oil_tests', (select json_agg(x) from (select * from oil_tests order by tested_at desc limit 30) x),
 'chicken_marinations', (select json_agg(x) from (select * from chicken_marinations order by created_at desc limit 30) x),
 'brands', (select json_agg(x) from brands x),
 'branch_brands', (select json_agg(x) from branch_brands x),
 'shifts', (select json_agg(x) from shifts x),
 'checklist_rules', (select json_agg(x) from checklist_rules x)
) r;
