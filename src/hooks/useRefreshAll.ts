import { useCallback } from 'react';
import { useOilTests } from '@/hooks/useOilTests';
import { useChicken } from '@/hooks/useChicken';
import { useOrgSettings } from '@/hooks/useOrgSettings';

/**
 * Pull-to-refresh used to reload only tasks/reports, so a new oil test or
 * marination could sit unseen until the app restarted. This combines the
 * screen's own refresh with the oil and chicken data.
 */
export function useRefreshAll(base: () => Promise<void> | void) {
  const { refresh: refreshOil } = useOilTests();
  const { refresh: refreshChicken } = useChicken();
  // The control panel's rules too: a change made on another phone shows here
  // on the next pull-to-refresh.
  const { refresh: refreshSettings } = useOrgSettings();
  return useCallback(async () => {
    await Promise.all([Promise.resolve(base()), refreshOil(), refreshChicken(), refreshSettings()]);
  }, [base, refreshOil, refreshChicken, refreshSettings]);
}
