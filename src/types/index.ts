export type Priority = 'low' | 'medium' | 'high';

export type Role = 'owner' | 'team_admin' | 'employee';

export interface Profile {
  id: string; // auth.users.id
  orgId: string;
  /**
   * Every team this person belongs to. Empty for an owner, or an employee
   * working unattached. A team leader has exactly one in practice, though
   * nothing in the schema enforces that.
   */
  teamIds: string[];
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

// ── Checklists ──────────────────────────────────────────────────────
// A repeating inspection form (e.g. the daily hygiene sheet), reused across
// however many people it's assigned to, rather than one task per person.

/** A question before it's saved — used both for the built-in seed content and while authoring. */
export interface ChecklistItemDraft {
  sectionTitle: string; // '' = no section
  question: string;
}

export interface ChecklistTemplate {
  id: string;
  orgId: string;
  name: string;
  /** Hours after a submission before it's due again. No due time or shift concept on purpose. */
  cooldownHours: number;
  /** A note is required to explain a "No" answer; never required on "Yes". Photos are always optional. */
  requiresNoteOnNo: boolean;
  archived: boolean;
  createdBy: string;
  createdAt: string;
}

export interface ChecklistTemplateItem {
  id: string;
  templateId: string;
  sectionTitle: string;
  sortOrder: number;
  question: string;
}

export interface ChecklistAssignment {
  id: string;
  templateId: string;
  orgId: string;
  teamId: string | null;
  assigneeId: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export type ChecklistSubmissionStatus = 'completed' | 'off_duty_pending' | 'off_duty_approved' | 'off_duty_rejected';

export interface ChecklistSubmission {
  id: string;
  assignmentId: string | null;
  orgId: string;
  teamId: string | null;
  /** Snapshot, so renaming the template later doesn't rewrite old submissions. */
  templateName: string;
  actorId: string;
  status: ChecklistSubmissionStatus;
  offDutyReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  yesCount: number;
  noCount: number;
  createdAt: string;
}

export interface ChecklistAnswer {
  id: string;
  submissionId: string;
  sectionTitle: string;
  question: string;
  sortOrder: number;
  answer: boolean;
  note: string | null;
}

export interface ChecklistSectionPhoto {
  id: string;
  submissionId: string;
  sectionTitle: string;
  photoUrl: string;
  createdAt: string;
}

/**
 * Derived, never stored: is this assignment ready to be filled right now?
 * A rejected off-duty claim is due immediately (she claimed falsely and still
 * has to do it); a pending claim is not due (waiting on review); a completion
 * or an approved claim is due again after the cooldown.
 */
export function isChecklistDue(
  lastSubmission: Pick<ChecklistSubmission, 'status' | 'createdAt'> | null,
  cooldownHours: number,
  now: Date = new Date()
): boolean {
  if (!lastSubmission) return true;
  if (lastSubmission.status === 'off_duty_pending') return false;
  if (lastSubmission.status === 'off_duty_rejected') return true;
  const readyAt = new Date(lastSubmission.createdAt).getTime() + cooldownHours * 60 * 60 * 1000;
  return now.getTime() >= readyAt;
}
