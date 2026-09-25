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
 * How many daily checklists are still waiting for this reader's ✓. Only the
 * people who verify count anything: the admin, and the hygiene auditor once
 * that role exists. A branch manager no longer verifies, so he has no count.
 */
export function useUnverifiedChecklistCount(): number {
  const rows = useSupervisorChecklists();
  const { profile } = useAuth();
  const verifies = profile?.role === 'owner' || (profile?.role as string) === 'hygiene_auditor';
  return verifies ? rows.filter((r) => !r.reviewedBy).length : 0;
}
