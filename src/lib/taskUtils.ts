import type { OrgTask, TaskCompletion } from '@/types';
import { isChecklistDue } from '@/types';

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isOverdue(task: OrgTask): boolean {
  if (!task.due || task.completed) return false;
  const d = new Date(task.due);
  return d.getTime() < Date.now() && !isSameDay(d, new Date());
}

export function isUpcoming(task: OrgTask): boolean {
  if (!task.due || task.completed) return false;
  const d = new Date(task.due);
  return d.getTime() >= Date.now() && !isSameDay(d, new Date());
}

export function isTodayTask(task: OrgTask): boolean {
  if (task.completed) return false;
  return task.due ? isSameDay(new Date(task.due), new Date()) : true;
}

export function formatDue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (isSameDay(d, now)) return `Today ${time}`;
  if (isSameDay(d, tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

export function bucketTasks(tasks: OrgTask[]) {
  const overdue: OrgTask[] = [];
  const today: OrgTask[] = [];
  const upcoming: OrgTask[] = [];
  const completed: OrgTask[] = [];

  for (const t of tasks) {
    if (t.completed) completed.push(t);
    else if (isOverdue(t)) overdue.push(t);
    else if (isUpcoming(t)) upcoming.push(t);
    else today.push(t);
  }

  const byPriority = (a: OrgTask, b: OrgTask) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  };

  return {
    overdue: overdue.sort(byPriority),
    today: today.sort(byPriority),
    upcoming: upcoming.sort(byPriority),
    completed: completed.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
  };
}

/** history is newest-first, so the first match for this task is the latest. */
export function latestCompletionForTask(taskId: string, history: TaskCompletion[]): TaskCompletion | null {
  return history.find((h) => h.taskId === taskId) ?? null;
}

/**
 * A plain task's completed flag is the source of truth. A checklist task's
 * completed flag is not — the database leaves it true forever after the
 * first submission, so "is it done right now" has to be derived from the
 * cooldown instead: a rejected off-duty claim or an elapsed cooldown means
 * it's due again regardless of what the row says.
 */
export function effectiveTaskCompleted(task: OrgTask, history: TaskCompletion[], now: Date = new Date()): boolean {
  if (!task.templateId) return task.completed;
  const last = latestCompletionForTask(task.id, history);
  if (!last || last.action === 'reopened') return false;
  return !isChecklistDue(task, last, now);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
