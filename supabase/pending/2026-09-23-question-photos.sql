-- Per-question checklist photos.
--
-- Photos are attached to a SECTION today (checklist_section_photos.section_title).
-- The owner wants them attached to the QUESTION: answer yes or no, snap the
-- photo for that line.
--
-- A question is identified the same way checklist_answers identifies one —
-- by its sort_order within the submission — rather than by its text, because
-- the question text is a snapshot and an edit to the template must not
-- re-point old photos. Null keeps its old meaning: a photo of the whole
-- section, which is what every existing row is.
--
-- Safe to run while the app is live: the column is nullable with no default
-- backfill, the old three-argument shape of p_section_photos keeps working
-- (a missing item_sort_order reads as null), and nothing is dropped.

alter table public.checklist_section_photos
  add column if not exists item_sort_order int;

comment on column public.checklist_section_photos.item_sort_order is
  'The sort_order of the question this photo belongs to, matching checklist_answers.sort_order. Null = a photo of the whole section (every row created before per-question photos).';

create index if not exists checklist_section_photos_item_idx
  on public.checklist_section_photos(task_completion_id, item_sort_order);

-- Only the photo loop changes; everything else in set_task_completion is the
-- live definition unchanged. Replacing the whole function is deliberate —
-- Postgres has no way to patch one statement — so this file must be applied
-- against the CURRENT definition. Regenerate it from the live database with
--   select pg_get_functiondef('public.set_task_completion'::regproc);
-- before applying, if SETUP.sql has drifted from production.
--
--   for v_photo in select * from jsonb_array_elements(coalesce(p_section_photos, '[]'))
--   loop
--     insert into public.checklist_section_photos
--       (task_completion_id, section_title, photo_url, item_sort_order)
--     values (
--       v_completion_id,
--       coalesce(v_photo ->> 'section_title', ''),
--       v_photo ->> 'photo_url',
--       nullif(v_photo ->> 'item_sort_order', '')::int
--     );
--   end loop;
