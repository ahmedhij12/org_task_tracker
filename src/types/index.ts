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
  /**
   * teamId -> brand assigned in that branch, or null when none is set yet
   * (or the role is team_admin/owner, which never has one). Only has an
   * entry for teams this profile actually belongs to — mirrors teamIds.
   */
  teamBrandIds: Record<string, string | null>;
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
  /** Set once an owner deletes this (already deactivated) person. Kept only so past audits keep their name. */
  deletedAt: string | null;
  /** Self-set profile photo. */
  avatarUrl: string | null;
  /** Company ID code used at check-in/out, self-set. */
  employeeCode: string | null;
  createdAt: string;
}

export interface Organization {
  id: string;
  orgCode: string; // 5-digit numeric join code, e.g. "48213"
  name: string;
  ownerId: string;
  /** What one penalty point is worth in IQD. Owner-editable in Settings; applies from then on only. */
  iqdPerPoint: number;
  createdAt: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
  /** IANA zone of this branch; times display in it, not the viewer's. */
  timezone: string;
  /** Where the branch is, pinned by the admin on a map. Null until pinned. */
  lat?: number | null;
  lng?: number | null;
  /** How far from the pin still counts as being at the branch. */
  radiusM?: number;
}

export interface Brand {
  id: string;
  orgId: string;
  name: string;
  archived: boolean;
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
  /**
   * An admin's own recurring "go audit someone" task — the subject/branch/
   * shift are chosen fresh at each completion, not fixed at assignment.
   */
  isAudit: boolean;
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
  /**
   * Who this completion is ABOUT — equal to actorId for an ordinary task,
   * different only for an is_audit completion (whoever the auditor chose).
   */
  subjectProfileId: string;
  /** Only set on an is_audit completion. */
  shift: 'morning' | 'evening' | null;
  /** Penalty (negative) or bonus (positive), in fractional points. Only set on an is_audit completion. IQD = points * iqdPerPoint. */
  pointsAwarded: number | null;
  /** The org's IQD-per-point rate when this row was created — a later rate change never rewrites it. */
  iqdPerPoint: number;
  /** Audit quality out of 100, computed server-side from the checklist answers. Null for non-audits and template-less audits. */
  score: number | null;
  /** Audit-only: where the auditor's phone was when they signed. */
  signedLat: number | null;
  signedLng: number | null;
  signedAccuracyM: number | null;
  signedAddress: string | null;
  /** Supervisor daily checklist: the live selfie taken at submit. */
  selfieUrl: string | null;
  /** The auditor's signature. Only set on an is_audit completion. */
  signatureUrl: string | null;
  createdAt: string;
}

/** One entry in the append-only trail of points_awarded changes on an audit completion. */
export interface PointsAdjustment {
  id: string;
  taskCompletionId: string;
  previousPoints: number | null;
  newPoints: number;
  adjustedBy: string;
  reason: string | null;
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
  /** Omit to take the schema default (0.25) — only meaningful when editing an is_audit template. */
  pointWeight?: number;
}

export interface ChecklistTemplate {
  id: string;
  orgId: string;
  name: string;
  /** A note is required to explain a "No" answer; never required on "Yes". Photos are always optional. */
  requiresNoteOnNo: boolean;
  /** Who fills this daily: 'employee' (supervisors) or 'team_admin' (branch managers); null for audits/ad-hoc. A daily checklist needs a live selfie + location at submit. */
  assignToRole: 'employee' | 'team_admin' | null;
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
  /** How many points a "No" answer costs (0 for "Yes"). Only meaningful on an is_audit completion. */
  pointWeight: number;
}

export interface ChecklistAnswer {
  id: string;
  taskCompletionId: string;
  sectionTitle: string;
  question: string;
  sortOrder: number;
  /** null means the auditor marked this N/A — excluded from scoring. */
  answer: boolean | null;
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

export interface ReportPeriod {
  id: string;
  orgId: string;
  /** Always the 1st of the month, e.g. '2026-08-01'. */
  periodMonth: string;
  closedAt: string;
  closedBy: string;
}

/** One row per (subject, branch) — the shared shape returned by both
 * get_period_report and get_current_branch_summary. */
export interface BranchSummaryRow {
  branchId: string;
  branchName: string;
  brandId: string | null;
  brandName: string | null;
  subjectProfileId: string;
  subjectName: string;
  /** Effective total — the natural sum, overridden by adjust_period_points if the owner made an end-of-month call. */
  totalPoints: number;
  iqdAmount: number;
  /** Only set by get_period_report (a closed period never re-sums live): the untouched natural sum, before any period-level adjustment. */
  rawPoints?: number;
  rawIqdAmount?: number;
  /** Only set by get_current_branch_summary: sum and count of this month's audit scores. */
  scoreSum?: number;
  scoreCount?: number;
}

/** One entry in the append-only trail of a whole period's total being adjusted for one supervisor at once. */
export interface PeriodAdjustment {
  id: string;
  periodId: string;
  subjectProfileId: string;
  previousPoints: number | null;
  newPoints: number;
  /** The rate in force when this override was made: IQD = newPoints * iqdPerPoint. */
  iqdPerPoint: number;
  /** Effective IQD total right before this override. */
  previousIqd: number | null;
  adjustedBy: string;
  reason: string | null;
  createdAt: string;
}

/** A fryer/station at a branch that gets oil-tested. Admin-managed. */
export interface OilFryer {
  id: string;
  orgId: string;
  teamId: string;
  name: string;
  sortOrder: number;
  archived: boolean;
}

export type OilGrade = 'good' | 'watch' | 'change';

/** One oil-tester reading of one fryer. grade is derived from tpm at write time. */
export interface OilTest {
  id: string;
  orgId: string;
  teamId: string;
  fryerId: string;
  fryerName?: string;
  actorId: string;
  actorName?: string;
  isAudit: boolean;
  tpm: number;
  tempC: number | null;
  filtered: boolean;
  grade: OilGrade;
  photoUrl: string;
  signatureUrl: string | null;
  note: string | null;
  testedAt: string;
  /** The scheduled slot this test belongs to (2 PM / 7 PM / 1 AM), if any. */
  slotTime?: string | null;
  /** Minutes past the grace window; null when on time. */
  minutesLate?: number | null;
  lateReason?: string | null;
}

/** One chicken marination record. Supervisor/manager records it; auditor views. */
export interface ChickenMarination {
  id: string;
  orgId: string;
  teamId: string;
  actorId: string;
  actorName?: string;
  isAudit: boolean;
  marinatedAt: string;
  countIn: number | null;
  unloadedAt: string | null;
  countOut: number | null;
  note: string | null;
  signatureUrl: string | null;
  /** When the vinegar must come out; null if no reminder was asked for. */
  remindAt?: string | null;
  /** Photo taken when the vinegar was removed — the proof it happened. */
  unloadPhotoUrl?: string | null;
  /** Who emptied it — often a different shift from whoever marinated. */
  unloadedByName?: string | null;
}
