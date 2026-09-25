# Grants for new tables — already automatic, don't add GRANT per-table

From **2026-10-30**, Supabase stops auto-granting Data API access to new
tables created in `public` on existing projects. Without a grant, the API
returns `permission denied` for that table.

**This project is already immune.** `SETUP.sql` (~line 2996) runs:

```sql
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
```

`ALTER DEFAULT PRIVILEGES` tells Postgres "any table created from now on by
this same role gets these grants automatically." It only covers tables
created by the role that ran it — `postgres`, which is who you are whenever
you run SQL through the Supabase SQL Editor (or any script connected as the
project's postgres user). Every migration in `pending/` has been created
that way, so every new table already inherits full grants with no per-table
`GRANT` line — confirmed for `oil_tests` (created 2026-09-22, no GRANT of
its own) on 2026-09-25.

## What to do when adding a new table

Nothing extra — create it the normal way (a `.sql` file in `pending/`, run
through the SQL Editor). It will already have Data API access.

## The one case this doesn't cover

If a table is ever created through a **different role** — a separate service
account, a CI pipeline with its own Postgres credentials, anything other than
the SQL Editor's `postgres` connection — the default-privilege rule won't
apply to it. In that case, run for that table:

```sql
grant select, insert, update, delete on public.<table> to authenticated, service_role;
```

## How to double-check anytime

Run in the SQL Editor:

```sql
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = '<your_table>';
```

Look for `authenticated` and `service_role` rows.
