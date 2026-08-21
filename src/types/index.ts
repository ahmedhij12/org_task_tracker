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
  /**
   * Set when this task is a checklist built from a template rather than a
   * plain one-off task. A checklist task is otherwise a normal task — same
   * table, same row.
   */
  templateId: string | null;
  /** Hours after a completion before this checklist is due again. Only set when templateId is. No due time or shift concept on purpose. */
  cooldownHours: number | null;
  /**
   * Whether this task needs the assigning leader/admin to review and
   * acknowledge each completion before it's considered settled. Driven by
   * priority: locked false on 'low', locked true on 'high', a free choice
   * on 'medium'.
   */
  requiresReview: boolean;
  completed: boolean;
  completedBy: string | null;
  completedAt: string | null;
  proofNote: string | null;
  /** Photos from the current completion. Cleared when the task is reopened — the permanent copy lives in TaskCompletion. */
  proofPhotoUrls: string[];
  createdAt: string;
  createdBy: string;
}

export type TaskCompletionAction = 'completed' | 'reopened' | 'off_duty';
export type TaskCompletionStatus = 'off_duty_pending' | 'off_duty_approved' | 'off_duty_rejected';

/** One entry in the permanent audit log: a task being completed, reopened, or an off-duty claim on a checklist. */
export interface TaskCompletion {
  id: string;
  taskId: string;
  orgId: string;
  teamId: string;
  /** Snapshot of the title, so history stays readable if the task is renamed. */
  taskTitle: string;
  actorId: string;
  action: TaskCompletionAction;
  note: string | null;
  photoUrls: string[];
  /** The deadline as it stood at that moment. */
  dueAt: string | null;
  wasLate: boolean;
  /** Only set for action = 'off_duty': where the claim stands. */
  status: TaskCompletionStatus | null;
  offDutyReason: string | null;
  /** Set once a leader/admin has reviewed this completion (regular review) or this claim (off-duty review). */
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Only set when the task is a checklist: how many questions were answered yes/no. */
  yesCount: number | null;
  noCount: number | null;
  createdAt: string;
}

/** Derived, never stored: a task is failed once its deadline passes while still open. */
export function isFailed(task: Pick<OrgTask, 'completed' | 'due'>, now: Date = new Date()): boolean {
  if (task.completed || !task.due) return false;
  return new Date(task.due).getTime() < now.getTime();
}

/**
 * Derived, never stored: this completion is still waiting on a leader/admin
 * to acknowledge it. An off-duty claim always needs review (attendance, not
 * work quality); a regular completion only needs it when the task itself is
 * marked requiresReview (the priority-driven rule set at task creation).
 */
export function needsReview(
  completion: Pick<TaskCompletion, 'action' | 'status' | 'reviewedBy'>,
  task: Pick<OrgTask, 'requiresReview'>
): boolean {
  if (completion.reviewedBy) return false;
  if (completion.status === 'off_duty_pending') return true;
  return completion.action === 'completed' && task.requiresReview;
}

export type ThemePref = 'light' | 'dark' | 'auto';

// ── Checklist templates ─────────────────────────────────────────────
// A checklist is a task with a template attached (task.templateId), not a
// separate data model. The template just holds the reusable set of
// questions; assigning it is just creating a task that points at it.

/** A question before it's saved — used both for the built-in seed content and while authoring. */
export interface ChecklistItemDraft {
  sectionTitle: string; // '' = no section
  question: string;
}

export interface ChecklistTemplate {
  id: string;
  orgId: string;
  name: string;
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

export interface ChecklistAnswer {
  id: string;
  taskCompletionId: string;
  sectionTitle: string;
  question: string;
  sortOrder: number;
  answer: boolean;
  note: string | null;
}

export interface ChecklistSectionPhoto {
  id: string;
  taskCompletionId: string;
  sectionTitle: string;
  photoUrl: string;
  createdAt: string;
}

/**
 * Derived, never stored: is this checklist task ready to be filled right now?
 * A rejected off-duty claim is due immediately (she claimed falsely and still
 * has to do it); a pending claim is not due (waiting on review); a completion
 * or an approved claim is due again after the cooldown.
 */
export function isChecklistDue(
  task: Pick<OrgTask, 'cooldownHours'>,
  lastCompletion: Pick<TaskCompletion, 'status' | 'createdAt'> | null,
  now: Date = new Date()
): boolean {
  if (!lastCompletion) return true;
  if (lastCompletion.status === 'off_duty_pending') return false;
  if (lastCompletion.status === 'off_duty_rejected') return true;
  if (task.cooldownHours == null) return false;
  const readyAt = new Date(lastCompletion.createdAt).getTime() + task.cooldownHours * 60 * 60 * 1000;
  return now.getTime() >= readyAt;
}
