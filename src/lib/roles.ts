import type { Profile } from '@/types';

/**
 * Who may do what, in one place. "Admin" is the database's role 'owner' (the
 * super admin is an owner with is_super_admin). The hygiene auditor reads and
 * audits every branch like an admin, but has no Branches, Staff or Control
 * panel — those stay isAdmin().
 */
type P = Pick<Profile, 'role' | 'isSuperAdmin'> | null | undefined;

export const isAdmin = (p: P) => p?.role === 'owner';
export const isHygieneAuditor = (p: P) => p?.role === 'hygiene_auditor';
/** Reads every branch: history, oil, marination, the report. */
export const seesAllBranches = (p: P) => isAdmin(p) || isHygieneAuditor(p);
/** Verifies checklists, audits, edits the checklist templates and audit points. */
export const auditsAndVerifies = (p: P) => isAdmin(p) || isHygieneAuditor(p);
