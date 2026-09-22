import { useMemo } from 'react';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
import { useAuth } from '@/hooks/useAuth';
import type { TaskCompletion } from '@/types';

/**
 * A supervisor's submitted daily checklist — found by its template being
 * the org's supervisor-daily one, or (if the task was since deleted) by the
 * selfie only that checklist carries.
 */
export function useSupervisorChecklists(): TaskCompletion[] {
  const { history, tasks } = useOrgData();
  const { templates } = useChecklists();
  return useMemo(() => {
    const dailyTemplateIds = new Set(templates.filter((t) => t.assignToRole).map((t) => t.id));
    const dailyTaskIds = new Set(tasks.filter((t) => t.templateId && dailyTemplateIds.has(t.templateId)).map((t) => t.id));
    return history.filter(
      (h) => h.action === 'completed' && ((h.taskId && dailyTaskIds.has(h.taskId)) || !!h.selfieUrl)
    );
  }, [history, tasks, templates]);
}


/**
 * How many daily checklists are still waiting for this reader's ✓. A branch
 * manager counts only their own branch, never their own checklist (the
 * admin verifies that one).
 */
export function useUnverifiedChecklistCount(): number {
  const rows = useSupervisorChecklists();
  const { profile } = useAuth();
  return rows.filter(
    (r) =>
      !r.reviewedBy &&
      (profile?.role === 'owner' || (r.actorId !== profile?.id && !!profile?.teamIds.includes(r.teamId)))
  ).length;
}
