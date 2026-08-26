# Personal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully separate "Personal" account type — real email + password signup, no organization, no role, no team — with its own simple task list and due-date push notifications.

**Architecture:** Personal accounts reuse Supabase Auth (`auth.users`) for login only. The *absence* of a `profiles` row is what makes an account "personal" — a metadata flag set at signup (`account_kind: 'personal'`) tells the root router to show personal screens instead of routing back into org onboarding. Personal data lives in two new tables (`personal_tasks`, `push_tokens`) that reference only `auth.users`, never `organizations` or `profiles` — no shared foreign key exists, so personal and company data cannot intersect by construction. Reminders are sent by a Supabase Edge Function on a schedule, via Expo's free push service.

**Tech Stack:** Expo SDK 57, expo-router, Supabase (Postgres + Auth + Edge Functions), `expo-notifications` + `expo-device` (new deps), TypeScript.

**Spec:** [docs/superpowers/specs/2026-08-24-personal-mode-design.md](../specs/2026-08-24-personal-mode-design.md)

## Global Constraints

- No Basra Delight branding anywhere in the app, including placeholder/example text (owner's explicit instruction, already applied once in Task 0 of this plan's prerequisites — see note in Task 6).
- This project has no Supabase CLI link and no service-role key in `.env` — Claude cannot run SQL or deploy Edge Functions directly. Every DB/Edge-Function step in this plan ends with "hand this to the user to paste into Supabase Studio," matching how `SETUP.sql`/`TESTS.sql` are already applied in this project.
- No JS test framework exists in this repo (confirmed: no jest/testing-library in `package.json`). Verification is `npm run typecheck` after every code change, SQL-level assertions in `TESTS.sql` for the DB layer, and an on-device manual pass for UI/notifications — the same pattern already used for every other feature in this codebase.
- Company account behavior (routing, screens, RPCs) must not change. Every task below is additive; if a step requires editing a shared file (`useAuth.tsx`, `_layout.tsx`), the diff must be additive-only — no existing branch's behavior changes.
- Resolved open question from the spec (§9): a company account (has a `profiles` row) can never reach Personal-mode screens from the same login — the root router's guard requires `!profile`. Someone wanting both uses two separate logins (two different emails), which satisfies "fully separate" from the spec.

---

## Task 1: Database schema — `personal_tasks` and `push_tokens`

**Files:**
- Modify: `supabase/SETUP.sql` (append drop statements near the top's "Clean slate" section, append table + RLS definitions near the end)
- Modify: `supabase/TESTS.sql` (append RLS isolation tests)

**Interfaces:**
- Produces: `public.personal_tasks` table — columns `id uuid`, `owner_id uuid`, `title text`, `notes text|null`, `due timestamptz|null`, `completed boolean`, `completed_at timestamptz|null`, `reminder_sent_at timestamptz|null`, `created_at timestamptz`.
- Produces: `public.push_tokens` table — columns `id uuid`, `owner_id uuid`, `expo_push_token text`, `platform text`, `created_at timestamptz`.
- Both RLS-scoped to `owner_id = auth.uid()`, no exceptions, no admin bypass.

- [ ] **Step 1: Add drop statements to the "Clean slate" section**

In `supabase/SETUP.sql`, find the block of `drop table if exists ...` statements at the top (starts around line 12: `drop table if exists public.profile_teams cascade;`). Add two more lines right after the existing table drops, before the `drop function` block:

```sql
drop table if exists public.push_tokens cascade;
drop table if exists public.personal_tasks cascade;
```

- [ ] **Step 2: Append the table definitions and RLS policies at the end of the file**

Add this new section at the very end of `supabase/SETUP.sql`, after the existing "Storage bucket for proof photos" section:

```sql
-- ── Personal mode ──────────────────────────────────────────────────
-- Fully separate from the org system by construction: neither table below
-- has an org_id or any foreign key into organizations/profiles/teams. A
-- personal account is identified purely by auth.uid() — there is no
-- "personal profile" row anywhere. See
-- docs/superpowers/specs/2026-08-24-personal-mode-design.md.

create table public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  due timestamptz,
  completed boolean not null default false,
  completed_at timestamptz,
  -- Set once a reminder has fired for this due date, so the scheduled job
  -- never notifies the same task twice.
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.personal_tasks enable row level security;

create policy "a user can only ever touch their own personal tasks"
  on public.personal_tasks for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index personal_tasks_owner_due_idx
  on public.personal_tasks (owner_id, due);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  unique (owner_id, expo_push_token)
);

alter table public.push_tokens enable row level security;

create policy "a user can only manage their own push tokens"
  on public.push_tokens for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
```

- [ ] **Step 3: Add RLS isolation tests to `supabase/TESTS.sql`**

Open `supabase/TESTS.sql`. Find the `begin;` near the top (the whole file runs inside one transaction that rolls back at the end). Add this new `do $$ ... $$;` block right before the final `rollback;` at the end of the file:

```sql
-- ── Personal mode: RLS isolation ─────────────────────────────────────

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_task_a uuid;
  v_visible_count int;
  v_update_count int;
begin
  -- Matches the auth.users insert pattern already used above in this file
  -- (the table has NOT NULL constraints on far more than id/email).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_user_a, 'authenticated', 'authenticated',
     'personal-test-a@example.com', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_user_b, 'authenticated', 'authenticated',
     'personal-test-b@example.com', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '', '', '', '', '');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  set role authenticated;

  insert into public.personal_tasks (owner_id, title)
  values (v_user_a, 'A''s private task')
  returning id into v_task_a;

  -- A can see their own task.
  select count(*) into v_visible_count from public.personal_tasks where id = v_task_a;
  if v_visible_count <> 1 then
    raise exception 'FAIL: owner cannot see their own personal task';
  end if;
  raise notice 'PASS: owner sees their own personal task';

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b)::text, true);
  set role authenticated;

  -- B cannot see A's task at all.
  select count(*) into v_visible_count from public.personal_tasks where id = v_task_a;
  if v_visible_count <> 0 then
    raise exception 'FAIL: a different user can see someone else''s personal task';
  end if;
  raise notice 'PASS: a different user cannot see this personal task';

  -- B cannot update A's task either (RLS blocks the row, so 0 rows affected).
  update public.personal_tasks set completed = true where id = v_task_a;
  get diagnostics v_update_count = row_count;
  if v_update_count <> 0 then
    raise exception 'FAIL: a different user could update someone else''s personal task';
  end if;
  raise notice 'PASS: a different user cannot update this personal task';

  reset role;
end $$;

do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_visible_count int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_user_a, 'authenticated', 'authenticated',
     'personal-test-c@example.com', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_user_b, 'authenticated', 'authenticated',
     'personal-test-d@example.com', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '', '', '', '', '');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  set role authenticated;

  insert into public.push_tokens (owner_id, expo_push_token, platform)
  values (v_user_a, 'ExponentPushToken[test-a]', 'ios');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b)::text, true);
  set role authenticated;

  select count(*) into v_visible_count from public.push_tokens where owner_id = v_user_a;
  if v_visible_count <> 0 then
    raise exception 'FAIL: a different user can see someone else''s push token';
  end if;
  raise notice 'PASS: a different user cannot see this push token';

  reset role;
end $$;
```

- [ ] **Step 4: Hand both files to the user to run**

Tell the user: paste the full `SETUP.sql` into Supabase Studio → SQL Editor → Run (this wipes and rebuilds everything, same as before), then paste the full `TESTS.sql` and confirm every block reports `PASS:` with no `ERROR`.

- [ ] **Step 5: Commit**

```bash
git add supabase/SETUP.sql supabase/TESTS.sql
git commit -m "feat(personal): add personal_tasks and push_tokens tables with RLS"
```

---

## Task 2: Types for personal tasks

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `PersonalTask` interface, used by Task 4 (hook) and Task 6 (screen).

- [ ] **Step 1: Add the type**

Append to the end of `src/types/index.ts`:

```typescript
export interface PersonalTask {
  id: string;
  ownerId: string;
  title: string;
  notes: string | null;
  due: string | null; // ISO string
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this is an additive, unused-so-far type).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(personal): add PersonalTask type"
```

---

## Task 3: Auth — personal signup/sign-in and mode detection

**Files:**
- Modify: `src/hooks/useAuth.tsx`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase` (already imported in this file).
- Produces: `createPersonalAccount(email: string, password: string): Promise<void>`, `signInPersonal(email: string, password: string): Promise<void>`, and a new boolean field `isPersonalAccount` on the value returned by `useAuth()`.

- [ ] **Step 1: Add `isPersonalAccount` to the context type and computed value**

In `src/hooks/useAuth.tsx`, add to the `AuthContextValue` interface (near the top, alongside `session`, `profile`, etc. — note `AuthContextValue extends AuthState`, so add it there or as its own field; add it as its own field on `AuthContextValue` since it's derived, not raw state):

```typescript
interface AuthContextValue extends AuthState {
  /** True for a signed-in session that deliberately has no organization —
   *  see docs/superpowers/specs/2026-08-24-personal-mode-design.md. */
  isPersonalAccount: boolean;
  createOrganization: (args: {
```

(That's the existing `createOrganization` line right after — just confirming placement; don't duplicate it.)

- [ ] **Step 2: Add the two new methods to the interface**

In the same interface block, add after `signOut: () => Promise<void>;`:

```typescript
  createPersonalAccount: (email: string, password: string) => Promise<void>;
  signInPersonal: (email: string, password: string) => Promise<void>;
```

- [ ] **Step 3: Implement `createPersonalAccount`**

Inside `AuthProvider`, add this function near `createOrganization` (after it, before `adminCreateUser`):

```typescript
  const createPersonalAccount: AuthContextValue['createPersonalAccount'] = async (email, password) => {
    setState((s) => ({ ...s, error: null }));
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { account_kind: 'personal' } },
    });
    if (signUpError) throw signUpError;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error(
        'Account created, but no session yet — this Supabase project likely has "Confirm email" turned on. Disable it under Authentication > Providers > Email while testing.'
      );
    }
  };
```

Note: this deliberately does **not** call `refreshProfile()` — a personal account never gets a `profiles` row, so there is nothing to load. `loadProfileAndOrg` (already in this file) already handles "signed in, no profile" gracefully by setting `profile: null`; the `onAuthStateChange` listener already wired up at the top of `AuthProvider` will pick up this new session automatically.

- [ ] **Step 4: Implement `signInPersonal`**

Add right after `createPersonalAccount`:

```typescript
  const signInPersonal: AuthContextValue['signInPersonal'] = async (email, password) => {
    setState((s) => ({ ...s, error: null }));
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  };
```

- [ ] **Step 5: Compute `isPersonalAccount` and expose everything from the provider**

Find the `value = useMemo<AuthContextValue>(...)` block near the bottom of the file. Add the computed field and the two new methods:

```typescript
  const isPersonalAccount = !!state.session && !state.profile && state.session.user.user_metadata?.account_kind === 'personal';

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isPersonalAccount,
      createOrganization,
      createPersonalAccount,
      signInWithUsername,
      signInPersonal,
      adminCreateUser,
      adminResetPassword,
      adminSetUserActive,
      addProfileToTeam,
      removeProfileFromTeam,
      changeOwnPassword,
      addRecoveryEmail,
      signOut,
      refreshProfile,
      clearError,
    }),
    [state, isPersonalAccount]
  );
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAuth.tsx
git commit -m "feat(personal): add personal account signup/sign-in and mode detection"
```

---

## Task 4: Root routing — add the `(personal)` stack

**Files:**
- Modify: `src/app/_layout.tsx`
- Create: `src/app/(personal)/_layout.tsx`

**Interfaces:**
- Consumes: `isPersonalAccount` from `useAuth()` (Task 3).
- Produces: a new protected route group `(personal)` that Task 5/6/7 screens live under.

- [ ] **Step 1: Create the personal stack's own layout**

Create `src/app/(personal)/_layout.tsx`, mirroring the existing `src/app/(auth)/_layout.tsx` exactly:

```typescript
import { Stack } from 'expo-router';

export default function PersonalLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 2: Wire the guard into the root navigator**

In `src/app/_layout.tsx`, update `RootNavigator`:

```typescript
function RootNavigator() {
  const { session, profile, loading, isPersonalAccount } = useAuth();
  const { isDark } = useThemePref();

  if (loading) return null;

  const signedInWithOrg = !!session && !!profile;
  const needsPasswordChange = signedInWithOrg && !!profile?.mustChangePassword;

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedInWithOrg && !isPersonalAccount}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={needsPasswordChange}>
          <Stack.Screen name="change-password" />
        </Stack.Protected>
        <Stack.Protected guard={signedInWithOrg && !needsPasswordChange}>
          <Stack.Screen name="(main)" />
        </Stack.Protected>
        <Stack.Protected guard={isPersonalAccount}>
          <Stack.Screen name="(personal)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
```

Only the guard expressions on the first two `Stack.Protected` blocks and the new fourth block changed; the `(main)` block is untouched.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (The `(personal)` route has no screens yet beyond `_layout.tsx` — that's fine, Task 5 adds `index.tsx`.)

- [ ] **Step 4: Commit**

```bash
git add src/app/_layout.tsx "src/app/(personal)/_layout.tsx"
git commit -m "feat(personal): wire up the (personal) protected route stack"
```

---

## Task 5: Auth UI — entry point and the personal sign-up/sign-in screen

**Files:**
- Modify: `src/app/(auth)/index.tsx`
- Create: `src/app/(auth)/personal.tsx`

**Interfaces:**
- Consumes: `createPersonalAccount`, `signInPersonal` from `useAuth()` (Task 3); `FieldInput`, `PrimaryButton`, `ErrorBanner`, `ScreenTitle`, `ScreenSubtitle`, `useThemeColors` from `@/components/ui`.

- [ ] **Step 1: Add the entry point to the landing screen**

In `src/app/(auth)/index.tsx`, add a third `ChoiceRow` after the existing "Create an organization" one, before the "Already have an account?" link:

```typescript
        <ChoiceRow
          icon="business"
          title="Create an organization"
          subtitle="You'll be the owner, create teams, and add people."
          onPress={() => router.push('/(auth)/create')}
        />

        <View style={{ height: 12 }} />

        <ChoiceRow
          icon="person"
          title="Just for yourself"
          subtitle="A private task list with reminders — no company involved."
          onPress={() => router.push('/(auth)/personal')}
        />

        <Pressable onPress={() => router.push('/(auth)/signin')} style={{ marginTop: 24, alignItems: 'center' }}>
```

(The `Pressable` line already exists — this just shows where the new block goes relative to it. `View` is already imported at the top of this file.)

- [ ] **Step 2: Create the personal auth screen**

Create `src/app/(auth)/personal.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function PersonalAuthScreen() {
  const c = useThemeColors();
  const { createPersonalAccount, signInPersonal } = useAuth();

  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim() && password.length >= 6;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'create') {
        await createPersonalAccount(email.trim(), password);
      } else {
        await signInPersonal(email.trim(), password);
      }
      // Root layout's Stack.Protected guard flips automatically once the
      // session (and its account_kind metadata) loads.
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={{ marginBottom: 20 }}>
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </Pressable>

          <ScreenTitle>{mode === 'create' ? 'Create your personal account' : 'Sign in'}</ScreenTitle>
          <ScreenSubtitle>
            {mode === 'create'
              ? 'Just your email and a password — no organization needed.'
              : 'Use the email and password from your personal account.'}
          </ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <FieldInput label="Password" placeholder="At least 6 characters" value={password} onChangeText={setPassword} secureTextEntry />

          <View style={{ height: 8 }} />
          <PrimaryButton
            title={mode === 'create' ? 'Create account' : 'Sign in'}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
          />

          <Pressable onPress={() => setMode(mode === 'create' ? 'signin' : 'create')} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, color: c.textMuted }}>
              {mode === 'create' ? 'Already have a personal account? ' : "Don't have one yet? "}
              <Text style={{ color: c.indigo, fontWeight: '700' }}>{mode === 'create' ? 'Sign in' : 'Create one'}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/index.tsx" "src/app/(auth)/personal.tsx"
git commit -m "feat(personal): add entry point and sign-up/sign-in screen"
```

---

## Task 6: `usePersonalTasks` hook

**Files:**
- Create: `src/hooks/usePersonalTasks.tsx`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `useAuth()` for `session`; `PersonalTask` type from Task 2.
- Produces: `usePersonalTasks()` returning `{ tasks: PersonalTask[], loading: boolean, refresh: () => Promise<void>, createTask: (args: { title: string; notes?: string; due?: string | null }) => Promise<void>, setCompletion: (id: string, completed: boolean) => Promise<void>, deleteTask: (id: string) => Promise<void> }`. Task 7's screen consumes this exact shape.

- [ ] **Step 1: Write the hook**

Create `src/hooks/usePersonalTasks.tsx`:

```typescript
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { PersonalTask } from '@/types';

function mapTask(row: {
  id: string;
  owner_id: string;
  title: string;
  notes: string | null;
  due: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
}): PersonalTask {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    notes: row.notes,
    due: row.due,
    completed: row.completed,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export function usePersonalTasks() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('personal_tasks')
      .select('*')
      .order('due', { ascending: true, nullsFirst: false });
    if (!error && data) setTasks(data.map(mapTask));
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTask = async ({ title, notes, due }: { title: string; notes?: string; due?: string | null }) => {
    if (!session) throw new Error('Not signed in.');
    const { error } = await supabase.from('personal_tasks').insert({
      owner_id: session.user.id,
      title,
      notes: notes ?? null,
      due: due ?? null,
    });
    if (error) throw error;
    await refresh();
  };

  const setCompletion = async (id: string, completed: boolean) => {
    const { error } = await supabase
      .from('personal_tasks')
      .update({ completed, completed_at: completed ? new Date().toISOString() : null })
      .eq('id', id);
    if (error) throw error;
    await refresh();
  };

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from('personal_tasks').delete().eq('id', id);
    if (error) throw error;
    await refresh();
  };

  return { tasks, loading, refresh, createTask, setCompletion, deleteTask };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePersonalTasks.tsx
git commit -m "feat(personal): add usePersonalTasks CRUD hook"
```

---

## Task 7: Personal task list screen and creation sheet

**Files:**
- Create: `src/components/PersonalTaskSheet.tsx`
- Create: `src/app/(personal)/index.tsx`

**Interfaces:**
- Consumes: `usePersonalTasks()` (Task 6); `DueDateField` from `@/components/DueDateField` (already fixed for theme + closeable in this session); `Card`, `PrimaryButton`, `SecondaryButton`, `FieldInput`, `ErrorBanner`, `useThemeColors` from `@/components/ui`.
- Produces: the personal-mode home screen, reachable once `isPersonalAccount` is true (Task 4's routing).

- [ ] **Step 1: Write the create-task sheet**

Create `src/components/PersonalTaskSheet.tsx`:

```typescript
import { useState } from 'react';
import { Modal, View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useThemeColors, FieldInput, PrimaryButton, SecondaryButton, ErrorBanner } from '@/components/ui';
import { DueDateField } from '@/components/DueDateField';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (args: { title: string; notes?: string; due?: string | null }) => Promise<void>;
}

export function PersonalTaskSheet({ visible, onCancel, onSubmit }: Props) {
  const c = useThemeColors();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [due, setDue] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setNotes('');
    setDue(null);
    setError(null);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleSubmit = async () => {
    if (!title.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), notes: notes.trim() || undefined, due: due ? due.toISOString() : null });
      reset();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save this task.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '90%', flexShrink: 1 }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>New task</Text>
              <Pressable onPress={handleCancel}>
                <Text style={{ fontSize: 14, color: c.textMuted }}>Cancel</Text>
              </Pressable>
            </View>

            {error ? <ErrorBanner message={error} /> : null}

            <FieldInput label="Title" placeholder="e.g. Call the accountant" value={title} onChangeText={setTitle} />
            <FieldInput label="Notes (optional)" placeholder="Any details" value={notes} onChangeText={setNotes} multiline />
            <DueDateField value={due} onChange={setDue} />

            <View style={{ height: 8 }} />
            <PrimaryButton title="Save task" onPress={handleSubmit} loading={loading} disabled={!title.trim()} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Write the personal home screen**

Create `src/app/(personal)/index.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Card } from '@/components/ui';
import { usePersonalTasks } from '@/hooks/usePersonalTasks';
import { PersonalTaskSheet } from '@/components/PersonalTaskSheet';
import { formatDue } from '@/lib/taskUtils';
import type { PersonalTask } from '@/types';

export default function PersonalHome() {
  const c = useThemeColors();
  const { tasks, loading, refresh, createTask, setCompletion, deleteTask } = usePersonalTasks();
  const [creating, setCreating] = useState(false);

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.indigo} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>My Tasks</Text>
          <Pressable onPress={() => router.push('/(personal)/settings')}>
            <Ionicons name="settings-outline" size={22} color={c.textMuted} />
          </Pressable>
        </View>

        {tasks.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: c.bgSubtle,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <Ionicons name="checkbox-outline" size={28} color={c.indigo} />
            </View>
            <Text style={{ fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 }}>
              Nothing here yet. Tap + to add something you don't want to forget.
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
              Open
            </Text>
            {open.map((t) => (
              <PersonalTaskRow key={t.id} task={t} onToggle={() => setCompletion(t.id, true)} onDelete={() => deleteTask(t.id)} />
            ))}

            {done.length > 0 ? (
              <>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
                  Done
                </Text>
                {done.map((t) => (
                  <PersonalTaskRow key={t.id} task={t} onToggle={() => setCompletion(t.id, false)} onDelete={() => deleteTask(t.id)} />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <Pressable
        onPress={() => setCreating(true)}
        accessibilityRole="button"
        accessibilityLabel="Add task"
        style={{
          position: 'absolute',
          right: 20,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.indigo,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: c.indigo,
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>

      <PersonalTaskSheet visible={creating} onCancel={() => setCreating(false)} onSubmit={async (args) => {
        await createTask(args);
        setCreating(false);
      }} />
    </SafeAreaView>
  );
}

function PersonalTaskRow({ task, onToggle, onDelete }: { task: PersonalTask; onToggle: () => void; onDelete: () => void }) {
  const c = useThemeColors();
  const overdue = !task.completed && task.due && new Date(task.due) < new Date();

  return (
    <Card style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: task.completed ? c.indigo : c.border,
          backgroundColor: task.completed ? c.indigo : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {task.completed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            color: task.completed ? c.textMuted : c.text,
            textDecorationLine: task.completed ? 'line-through' : 'none',
          }}
        >
          {task.title}
        </Text>
        {task.due ? (
          <Text style={{ fontSize: 12, color: overdue ? c.rose : c.textMuted, marginTop: 2 }}>{formatDue(task.due)}</Text>
        ) : null}
      </View>
      <Pressable onPress={onDelete} hitSlop={8}>
        <Ionicons name="trash-outline" size={18} color={c.textFaint} />
      </Pressable>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: an error that `/(personal)/settings` (used by the `router.push` in Step 2) doesn't exist yet — that's expected, Task 8 creates it. If typecheck fails for any *other* reason, fix it before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/components/PersonalTaskSheet.tsx "src/app/(personal)/index.tsx"
git commit -m "feat(personal): add personal task list screen and create-task sheet"
```

---

## Task 8: Personal settings screen (change password, sign out)

**Files:**
- Create: `src/app/(personal)/settings.tsx`

**Interfaces:**
- Consumes: `useAuth()` for `signOut` and `session`; `supabase.auth.updateUser` directly (no RPC needed — personal accounts have no `must_change_password` concept).

- [ ] **Step 1: Write the screen**

Create `src/app/(personal)/settings.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';

export default function PersonalSettingsScreen() {
  const c = useThemeColors();
  const { session, signOut } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword.length < 6) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword('');
      setNotice('Password updated.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 20 }}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>

        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 20 }}>Settings</Text>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Account</Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{session?.user.email}</Text>
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
            Change password
          </Text>
          {error ? <ErrorBanner message={error} /> : null}
          {notice ? <Text style={{ color: c.indigo, fontSize: 13, marginBottom: 10 }}>{notice}</Text> : null}
          <FieldInput placeholder="New password (6+ characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
          <PrimaryButton title="Update password" onPress={handleChangePassword} loading={saving} disabled={newPassword.length < 6} />
        </Card>

        {!confirmingSignOut ? (
          <Pressable onPress={() => setConfirmingSignOut(true)} style={{ paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.rose }}>Sign out</Text>
          </Pressable>
        ) : (
          <Card style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 13, color: c.text, marginBottom: 12 }}>
              Sign out? You'll need your email and password to sign back in.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setConfirmingSignOut(false)} style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: c.textMuted, fontSize: 14 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={signOut} style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: c.rose, fontSize: 14, fontWeight: '700' }}>Sign out</Text>
              </Pressable>
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```

This deliberately uses the same in-app two-step confirmation pattern as the company Settings screen — `Alert.alert` is imported but unused here on purpose left out entirely, since this project already found (and fixed, see ROADMAP.md "Two Alert.alert dead-on-web bugs") that `Alert.alert` silently does nothing on web.

- [ ] **Step 2: Remove the unused `Alert` import**

The code above imports `Alert` from `react-native` but never uses it (the confirmation is in-app, matching the note in Step 1). Remove `Alert` from the import line so it reads:

```typescript
import { View, Text, ScrollView, Pressable } from 'react-native';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors now (this screen existing also resolves the `/(personal)/settings` route-not-found error from Task 7 Step 3).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(personal)/settings.tsx"
git commit -m "feat(personal): add personal settings screen with password change and sign out"
```

---

## Task 9: Push notification client — permission, token registration

**Files:**
- Modify: `package.json` (add `expo-notifications`, `expo-device`)
- Modify: `app.json` (register the `expo-notifications` plugin)
- Create: `src/hooks/usePushRegistration.tsx`
- Modify: `src/app/(personal)/settings.tsx` (call the new hook)

**Interfaces:**
- Produces: `usePushRegistration()` — a hook with no return value; call it once from the personal settings screen. It requests permission, gets an Expo push token, and upserts it into `push_tokens`.

- [ ] **Step 1: Install the new dependencies**

Run:
```bash
npx expo install expo-notifications expo-device
```

Expected: `package.json` and `package-lock.json` update with `expo-notifications` and `expo-device` at versions compatible with this project's Expo SDK 57 (using `expo install` instead of plain `npm install` is what guarantees that compatibility).

- [ ] **Step 2: Register the plugin in `app.json`**

In `app.json`, find the `"plugins"` array (currently ends with `"expo-font"`). Add `"expo-notifications"`:

```json
    "plugins": [
      "expo-router",
      [
        "expo-image-picker",
        {
          "photosPermission": "OrgTasks lets you attach a photo as proof when completing a task.",
          "cameraPermission": "OrgTasks lets you take a photo as proof when completing a task."
        }
      ],
      "@react-native-community/datetimepicker",
      "expo-font",
      "expo-notifications"
    ],
```

- [ ] **Step 3: Write the registration hook**

Create `src/hooks/usePushRegistration.tsx`:

```typescript
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

/**
 * Requests notification permission and registers this device's Expo push
 * token, so the personal-reminders Edge Function (see
 * supabase/functions/send-personal-reminders) has somewhere to send to.
 * Silently does nothing on a simulator (no push capability) or if the user
 * denies permission — reminders just won't fire, nothing else breaks.
 */
export function usePushRegistration() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session || !Device.isDevice) return;

    (async () => {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      const { data: tokenData } = await Notifications.getExpoPushTokenAsync({
        projectId: '530bebab-883e-4990-9221-1774115305ec',
      });

      await supabase.from('push_tokens').upsert(
        {
          owner_id: session.user.id,
          expo_push_token: tokenData,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        },
        { onConflict: 'owner_id,expo_push_token' }
      );
    })();
  }, [session]);
}
```

The `projectId` is the same one already in `app.json` under `extra.eas.projectId` — hardcoded here to match, rather than importing `app.json` at runtime (this project doesn't do that elsewhere).

- [ ] **Step 4: Call the hook from the personal settings screen**

This file was created in Task 8 of this plan (personal settings screen) and already exists on disk — read its current content first rather than reconstructing it from memory. Add the import and the hook call as a two-line edit to the real file:

```typescript
import { usePushRegistration } from '@/hooks/usePushRegistration';
```

And inside `PersonalSettingsScreen`, right after the `useAuth()` line:

```typescript
export default function PersonalSettingsScreen() {
  const c = useThemeColors();
  const { session, signOut } = useAuth();
  usePushRegistration();
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app.json src/hooks/usePushRegistration.tsx "src/app/(personal)/settings.tsx"
git commit -m "feat(personal): register device for push notifications from settings"
```

---

## Task 10: Push notification server — Edge Function + schedule

**Files:**
- Create: `supabase/functions/send-personal-reminders/index.ts`

**Interfaces:**
- Consumes: `personal_tasks` and `push_tokens` tables (Task 1), via the Supabase service-role key that every Edge Function gets automatically as `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: nothing consumed by app code — this runs entirely server-side, deployed and scheduled manually by the user (Claude has no Supabase CLI access in this project — see Global Constraints).

- [ ] **Step 1: Write the function**

Create `supabase/functions/send-personal-reminders/index.ts`:

```typescript
// Runs on a schedule (set up manually in the Supabase dashboard — see the
// deployment instructions below). Finds personal tasks due in the next few
// minutes that haven't been reminded about yet, and pushes a notification
// to every device registered for that task's owner.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const REMINDER_WINDOW_MINUTES = 5;

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

  const { data: dueTasks, error: tasksError } = await supabase
    .from('personal_tasks')
    .select('id, owner_id, title')
    .eq('completed', false)
    .is('reminder_sent_at', null)
    .not('due', 'is', null)
    .lte('due', windowEnd.toISOString())
    .gte('due', now.toISOString());

  if (tasksError) {
    return new Response(JSON.stringify({ error: tasksError.message }), { status: 500 });
  }
  if (!dueTasks || dueTasks.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  let sent = 0;
  for (const task of dueTasks) {
    const { data: tokens } = await supabase.from('push_tokens').select('expo_push_token').eq('owner_id', task.owner_id);

    if (tokens && tokens.length > 0) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tokens.map((t) => ({
            to: t.expo_push_token,
            title: 'OrgTasks reminder',
            body: task.title,
            sound: 'default',
          }))
        ),
      });
      sent += tokens.length;
    }

    await supabase.from('personal_tasks').update({ reminder_sent_at: now.toISOString() }).eq('id', task.id);
  }

  return new Response(JSON.stringify({ sent, tasksNotified: dueTasks.length }), { status: 200 });
});
```

- [ ] **Step 2: Hand the user deployment instructions**

Since this project has no Supabase CLI link, tell the user:

1. Open Supabase Studio → **Edge Functions** in the left sidebar.
2. Click **Deploy a new function**, name it `send-personal-reminders`.
3. Open the file `supabase/functions/send-personal-reminders/index.ts` I just created, copy its full contents, and paste them into the function editor, replacing the placeholder code.
4. Deploy.
5. Still in Edge Functions, open `send-personal-reminders` → **Triggers** (or **Cron**, depending on the dashboard's current wording) → add a schedule of `*/5 * * * *` (every 5 minutes).

No secrets need to be added manually — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to every Edge Function in this project.

- [ ] **Step 3: Exclude the Edge Function from the app's TypeScript project**

This file uses Deno-only globals (`Deno.serve`, `Deno.env`) and a `jsr:` import specifier that the app's TypeScript setup doesn't understand. `tsconfig.json`'s `include` is the unscoped `"**/*.ts"`, so without this exclusion, `npm run typecheck` will start failing on this file.

Open `tsconfig.json` and add an `exclude` array (it doesn't have one today):

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": [
        "./src/*"
      ]
    }
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    ".expo/types/**/*.ts",
    "expo-env.d.ts"
  ],
  "exclude": [
    "supabase/functions/**"
  ]
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms the exclusion worked and nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-personal-reminders/index.ts tsconfig.json
git commit -m "feat(personal): add scheduled Edge Function to send due-task push reminders"
```

---

## Task 11: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Rebuild and install**

```bash
npx expo run:ios --device "Hijazi" --configuration Release
```

- [ ] **Step 2: Walk the flow on-device**

1. From the landing screen, tap "Just for yourself" → "Create account" with a real email + password.
2. Confirm you land on **My Tasks** (empty state), not the company dashboard.
3. Tap + , create a task with a due date ~2 minutes from now, save it.
4. Confirm the task shows under "Open" with its due time.
5. Grant notification permission when prompted (Settings screen, or on first personal-mode entry if wired there instead).
6. Wait for the due time to pass (within the 5-minute Edge Function schedule) and confirm a push notification arrives.
7. Tap the checkbox to mark it done — confirm it moves to "Done."
8. Go to Settings, change the password, sign out, sign back in with the new password.
9. Sign out, go back to the landing screen, sign in with a **company** account — confirm nothing about the company dashboard, People, Teams, or History screens changed.

- [ ] **Step 3: Report results**

Tell the user what passed and what didn't — this task has no automated pass/fail, it's the real acceptance test for the whole feature.
