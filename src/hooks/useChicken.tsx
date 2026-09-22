import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { ChickenMarination } from '../types';

function mapRow(row: any): ChickenMarination {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    actorId: row.actor_id,
    actorName: row.profiles?.name,
    isAudit: row.is_audit,
    marinatedAt: row.marinated_at,
    countIn: row.count_in == null ? null : Number(row.count_in),
    unloadedAt: row.unloaded_at,
    countOut: row.count_out == null ? null : Number(row.count_out),
    note: row.note,
    signatureUrl: row.signature_url,
  };
}

export interface SubmitChickenInput {
  teamId: string;
  marinatedAt: string;
  countIn: number | null;
  unloadedAt?: string | null;
  countOut?: number | null;
  note?: string | null;
  signatureUrl?: string | null;
  isAudit?: boolean;
}

interface ChickenContextValue {
  records: ChickenMarination[];
  loading: boolean;
  refresh: () => Promise<void>;
  submit: (input: SubmitChickenInput) => Promise<void>;
}

const ChickenContext = createContext<ChickenContextValue | undefined>(undefined);

export function ChickenProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [records, setRecords] = useState<ChickenMarination[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const res = await supabase
      .from('chicken_marinations')
      .select('*, profiles!chicken_marinations_actor_id_fkey(name)')
      .order('marinated_at', { ascending: false })
      .limit(500);
    if (!res.error) setRecords((res.data ?? []).map(mapRow));
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel('chicken')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chicken_marinations' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, refresh]);

  const submit = useCallback<ChickenContextValue['submit']>(
    async (input) => {
      const { error } = await supabase.rpc('submit_chicken_marination', {
        p_team_id: input.teamId,
        p_marinated_at: input.marinatedAt,
        p_count_in: input.countIn,
        p_unloaded_at: input.unloadedAt ?? null,
        p_count_out: input.countOut ?? null,
        p_note: input.note ?? null,
        p_signature_url: input.signatureUrl ?? null,
        p_is_audit: input.isAudit ?? false,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const value = useMemo(() => ({ records, loading, refresh, submit }), [records, loading, refresh, submit]);
  return <ChickenContext.Provider value={value}>{children}</ChickenContext.Provider>;
}

export function useChicken(): ChickenContextValue {
  const ctx = useContext(ChickenContext);
  if (!ctx) throw new Error('useChicken must be used within ChickenProvider');
  return ctx;
}
