-- 2026-09-25. The early marination grace starts at 5 min, not 10: his
-- guidance is a TIGHT early grace (5-10), and 10 against the 5-min late grace
-- made the control panel warn on its own defaults.
alter table public.org_settings alter column marination_early_grace_min set default 5;
-- Applied 2026-09-25 without the updated_by guard: the only edit on record was
-- a test round-trip of the oil grace, never a choice of early grace.
update public.org_settings set marination_early_grace_min = 5 where marination_early_grace_min = 10;
