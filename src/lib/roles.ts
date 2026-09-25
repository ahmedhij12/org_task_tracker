import type { Profile } from '@/types';

/**
 * Who may do what, in one place. "Admin" is the database's role 'owner' (the
 * super admin is an owner with is_super_admin). The hygiene auditor reads and
 * audits every branch like an admin, but has no Branches, Staff or Control
 * panel — those stay isAdmin().
 */
type P = Pick<Profile, 'role' | 'isSuperAdmin'> | null | undefined;

/**
 * The switches the super admin flips per role (Roles & permissions screen,
 * role_permissions in the database — has_permission() there is the real
 * gate; this only decides what to show).
 */
export type Permission = 'control_panel' | 'excuse_late' | 'edit_marination_start' | 'checklist_alerts';
export const PERMISSIONS: Permission[] = ['control_panel', 'excuse_late', 'edit_marination_start', 'checklist_alerts'];

/** What each role had before anyone flipped a switch — mirrors permission_default(). */
function permissionDefault(role: string | undefined, perm: Permission): boolean {
  switch (perm) {
    case 'control_panel':
      return role === 'owner';
    case 'excuse_late':
      return role === 'owner' || role === 'hygiene_auditor';
    case 'edit_marination_start':
      return role === 'owner' || role === 'team_admin';
    case 'checklist_alerts':
      return role === 'hygiene_auditor';
  }
}

/** Whether this person may do it: the server's answer when loaded, the role's default until then. */
export function can(p: (Pick<Profile, 'role' | 'isSuperAdmin'> & { permissions?: string[] | null }) | null | undefined, perm: Permission): boolean {
  if (!p) return false;
  if (p.permissions) return p.permissions.includes(perm);
  if (p.isSuperAdmin && perm !== 'checklist_alerts') return true;
  return permissionDefault(p.role, perm);
}

export const isAdmin = (p: P) => p?.role === 'owner';
export const isHygieneAuditor = (p: P) => p?.role === 'hygiene_auditor';
/** Reads every branch: history, oil, marination, the report. */
export const seesAllBranches = (p: P) => isAdmin(p) || isHygieneAuditor(p);
/** Verifies checklists, audits, edits the checklist templates and audit points. */
export const auditsAndVerifies = (p: P) => isAdmin(p) || isHygieneAuditor(p);
