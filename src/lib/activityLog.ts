import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

/**
 * What the app adds to the super admin's record of the admins (the database
 * records every change by itself — see 2026-09-25-admin-activity.sql): the
 * app being opened, screens and records opened, PDFs exported.
 *
 * Only an admin who is not the super admin, or a hygiene auditor, is
 * recorded; nobody else sends anything. Fire-and-forget: a failed log never
 * touches what the admin is doing, and nothing on screen ever reacts to it.
 */
export type ActivityKind = 'sign_in' | 'view' | 'export';

export function isWatchedAdmin(profile: Pick<Profile, 'role' | 'isSuperAdmin'> | null | undefined): boolean {
  // The hygiene auditor is watched too (his call, 2026-09-25). Compared as a
  // string until the role exists in the Profile type.
  return (profile?.role === 'owner' && !profile.isSuperAdmin) || (profile?.role as string) === 'hygiene_auditor';
}

export function logActivity(
  profile: Pick<Profile, 'role' | 'isSuperAdmin'> | null | undefined,
  kind: ActivityKind,
  what: string,
  detail?: Record<string, unknown>,
): void {
  if (!isWatchedAdmin(profile)) return;
  supabase
    .rpc('log_activity', { p_kind: kind, p_what: what, p_detail: detail ?? null })
    .then(
      () => {},
      () => {},
    );
}
