export type Priority = 'low' | 'medium' | 'high';

export type Role = 'owner' | 'team_admin' | 'employee';

export interface Profile {
  id: string; // auth.users.id
  orgId: string;
  teamId: string | null; // null only for an org owner not attached to a team
  name: string;
  title: string | null; // job title, e.g. "IT", "Accountant" — separate from permission role
  role: Role;
  createdAt: string;
}

export interface Organization {
  id: string;
  orgCode: string; // short human-shareable join code, e.g. "ACME482"
  name: string;
  ownerId: string;
  createdAt: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
}

export interface OrgTask {
  id: string;
  orgId: string;
  teamId: string;
  title: string;
  notes: string | null;
  due: string | null; // ISO string
  priority: Priority;
  assigneeId: string | null; // profile id, or null meaning "everyone on the team"
  requiresProof: boolean;
  completed: boolean;
  completedBy: string | null;
  completedAt: string | null;
  proofNote: string | null;
  proofPhotoUrl: string | null;
  createdAt: string;
  createdBy: string;
}

export type ThemePref = 'light' | 'dark' | 'auto';
