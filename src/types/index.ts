export type Priority = 'low' | 'medium' | 'high';

export type Role = 'owner' | 'team_admin' | 'employee';

export interface Profile {
  id: string; // auth.users.id
  orgId: string;
  teamId: string | null; // null only for an org owner not attached to a team
  name: string;
  title: string | null; // job title, e.g. "IT", "Accountant" — separate from permission role
  username: string | null;
  role: Role;
  /** True until the user picks their own password after an admin created or reset it. */
  mustChangePassword: boolean;
  /** Deactivated accounts cannot sign in. */
  active: boolean;
  /** Optional, added later by the user, only used for password recovery. */
  recoveryEmail: string | null;
  createdAt: string;
}

export interface Organization {
  id: string;
  orgCode: string; // 5-digit numeric join code, e.g. "48213"
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
  /** Photos from the current completion. Cleared when the task is reopened — the permanent copy lives in TaskCompletion. */
  proofPhotoUrls: string[];
  createdAt: string;
  createdBy: string;
}

/** One entry in the permanent audit log: a task being completed or reopened. */
export interface TaskCompletion {
  id: string;
  taskId: string;
  orgId: string;
  teamId: string;
  /** Snapshot of the title, so history stays readable if the task is renamed. */
  taskTitle: string;
  actorId: string;
  action: 'completed' | 'reopened';
  note: string | null;
  photoUrls: string[];
  /** The deadline as it stood at that moment. */
  dueAt: string | null;
  wasLate: boolean;
  createdAt: string;
}

/** Derived, never stored: a task is failed once its deadline passes while still open. */
export function isFailed(task: Pick<OrgTask, 'completed' | 'due'>, now: Date = new Date()): boolean {
  if (task.completed || !task.due) return false;
  return new Date(task.due).getTime() < now.getTime();
}

export type ThemePref = 'light' | 'dark' | 'auto';
