import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_MARINATION_RULES, type MarinationRules } from '@/lib/marination';

/**
 * The control panel's company-wide rules (public.org_settings). The app reads
 * the numbers instead of carrying them, so a change in the control panel
 * reaches every phone on its next refresh, with no new build.
 */
export interface OrgSettings {
  marinationHours: number;
  marinationEarlyGraceMin: number;
  marinationLateGraceMin: number;
  oilGraceMin: number;
  lateChecklistPenaltyIqd: number;
  marinationPenaltyIqd: number;
}

// What was live before the control panel — used until the row has loaded.
const DEFAULTS: OrgSettings = {
  marinationHours: DEFAULT_MARINATION_RULES.hours,
  marinationEarlyGraceMin: DEFAULT_MARINATION_RULES.earlyGraceMin,
  marinationLateGraceMin: DEFAULT_MARINATION_RULES.lateGraceMin,
  oilGraceMin: 10,
  lateChecklistPenaltyIqd: 0,
  marinationPenaltyIqd: 0,
};

interface Ctx {
  settings: OrgSettings;
  /** False until the real row has loaded — the cards must not save defaults over it. */
  loaded: boolean;
  marinationRules: MarinationRules;
  refresh: () => Promise<void>;
  save: (patch: Partial<OrgSettings>) => Promise<void>;
}

const OrgSettingsContext = createContext<Ctx>({
  settings: DEFAULTS,
  loaded: false,
  marinationRules: DEFAULT_MARINATION_RULES,
  refresh: async () => {},
  save: async () => {},
});

const toDb: Record<keyof OrgSettings, string> = {
  marinationHours: 'marination_hours',
  marinationEarlyGraceMin: 'marination_early_grace_min',
  marinationLateGraceMin: 'marination_late_grace_min',
  oilGraceMin: 'oil_grace_min',
  lateChecklistPenaltyIqd: 'late_checklist_penalty_iqd',
  marinationPenaltyIqd: 'marination_penalty_iqd',
};

export function OrgSettingsProvider({ children }: { children: ReactNode }) {
  const { organization } = useAuth();
  const [settings, setSettings] = useState<OrgSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!organization) return;
    const { data, error } = await supabase.from('org_settings').select('*').eq('org_id', organization.id).maybeSingle();
    if (error || !data) return;
    setSettings({
      marinationHours: Number(data.marination_hours),
      marinationEarlyGraceMin: data.marination_early_grace_min,
      marinationLateGraceMin: data.marination_late_grace_min,
      oilGraceMin: data.oil_grace_min,
      lateChecklistPenaltyIqd: data.late_checklist_penalty_iqd,
      marinationPenaltyIqd: data.marination_penalty_iqd,
    });
    setLoaded(true);
  }, [organization?.id]);

  useEffect(() => {
    refresh();
    // Coming back to the app picks up a change made on another phone.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const save = useCallback(
    async (patch: Partial<OrgSettings>) => {
      const body: Record<string, number> = {};
      for (const [k, v] of Object.entries(patch)) if (v != null) body[toDb[k as keyof OrgSettings]] = v as number;
      const { error } = await supabase.rpc('set_org_settings', { p: body });
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<Ctx>(
    () => ({
      settings,
      loaded,
      marinationRules: {
        hours: settings.marinationHours,
        earlyGraceMin: settings.marinationEarlyGraceMin,
        lateGraceMin: settings.marinationLateGraceMin,
      },
      refresh,
      save,
    }),
    [settings, loaded, refresh, save],
  );

  return <OrgSettingsContext.Provider value={value}>{children}</OrgSettingsContext.Provider>;
}

export function useOrgSettings() {
  return useContext(OrgSettingsContext);
}
