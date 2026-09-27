import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { auditsAndVerifies } from '@/lib/roles';

/**
 * "Mark as seen" (his ask, 2026-09-27): the people who verify — admins and
 * the hygiene auditor — hide alerts they have already seen, on their own
 * account only (public.alerts_seen). Nothing is deleted or verified: an item
 * newer than the mark is new again, and nobody else's view changes.
 */
export type AlertKind = 'checklists' | 'oil_change';

interface Ctx {
  /** Whether this person may mark alerts as seen at all. */
  canMark: boolean;
  /** Is an item from this moment still new to this person? */
  isNew: (kind: AlertKind, at: string) => boolean;
  /** Hide everything up to `until` — the newest item that was on screen. */
  markSeen: (kind: AlertKind, until: string) => Promise<void>;
}

const AlertsSeenContext = createContext<Ctx>({ canMark: false, isNew: () => true, markSeen: async () => {} });

export function AlertsSeenProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const canMark = auditsAndVerifies(profile);
  const [seen, setSeen] = useState<Partial<Record<AlertKind, number>>>({});

  useEffect(() => {
    setSeen({});
    if (!canMark || !profile) return;
    supabase
      .from('alerts_seen')
      .select('kind, seen_at')
      .eq('profile_id', profile.id)
      .then(({ data }) => {
        if (!data) return;
        const next: Partial<Record<AlertKind, number>> = {};
        for (const row of data) next[row.kind as AlertKind] = new Date(row.seen_at).getTime();
        setSeen(next);
      });
  }, [canMark, profile?.id]);

  const isNew = useCallback(
    (kind: AlertKind, at: string) => {
      const mark = seen[kind];
      return mark == null || new Date(at).getTime() > mark;
    },
    [seen]
  );

  const markSeen = useCallback(
    async (kind: AlertKind, until: string) => {
      const before = seen[kind];
      const at = new Date(until).getTime();
      // Gone at once; put back if the server refuses.
      setSeen((s) => ({ ...s, [kind]: Math.max(s[kind] ?? 0, at) }));
      const { data, error } = await supabase.rpc('mark_alerts_seen', { p_kind: kind, p_until: until });
      if (error) {
        setSeen((s) => ({ ...s, [kind]: before }));
        return;
      }
      if (data) setSeen((s) => ({ ...s, [kind]: new Date(data as string).getTime() }));
    },
    [seen]
  );

  const value = useMemo(() => ({ canMark, isNew, markSeen }), [canMark, isNew, markSeen]);
  return <AlertsSeenContext.Provider value={value}>{children}</AlertsSeenContext.Provider>;
}

export function useAlertsSeen(): Ctx {
  return useContext(AlertsSeenContext);
}
