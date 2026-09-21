import { useMemo } from 'react';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
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
    const dailyTemplateIds = new Set(templates.filter((t) => t.isSupervisorDaily).map((t) => t.id));
    const dailyTaskIds = new Set(tasks.filter((t) => t.templateId && dailyTemplateIds.has(t.templateId)).map((t) => t.id));
    return history.filter(
      (h) => h.action === 'completed' && ((h.taskId && dailyTaskIds.has(h.taskId)) || !!h.selfieUrl)
    );
  }, [history, tasks, templates]);
}


/** How many supervisor checklists are still waiting for a manager's ✓. */
export function useUnverifiedChecklistCount(): number {
  const rows = useSupervisorChecklists();
  return rows.filter((r) => !r.reviewedBy).length;
}
