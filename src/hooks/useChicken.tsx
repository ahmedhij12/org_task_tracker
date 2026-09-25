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
    dueAt: row.due_at ?? null,
    earlyGraceMin: row.early_grace_min ?? null,
    lateGraceMin: row.late_grace_min ?? null,
    countIn: row.count_in == null ? null : Number(row.count_in),
    unloadedAt: row.unloaded_at,
    countOut: row.count_out == null ? null : Number(row.count_out),
    note: row.note,
    remindAt: row.remind_at ?? null,
    unloadPhotoUrl: row.unload_photo_url ?? null,
    unloadedByName: row.unloader?.name ?? null,
    signatureUrl: row.signature_url,
    originalMarinatedAt: row.original_marinated_at ?? null,
    startEditedBy: row.start_edited_by ?? null,
    startEditedAt: row.start_edited_at ?? null,
    startEditReason: row.start_edit_reason ?? null,
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
  /** Ask for the "remove the vinegar" reminder when the marination hours are up. */
  remind?: boolean;
}

interface ChickenContextValue {
  records: ChickenMarination[];
  loading: boolean;
  refresh: () => Promise<void>;
  submit: (input: SubmitChickenInput) => Promise<void>;
  /** Record that a batch came out. The removal time is stamped by the server
   * (never the phone) and a photo is required as proof. */
  markUnloaded: (id: string, photoUrl: string, countOut?: number | null) => Promise<void>;
  /** The branch manager corrects when a batch went in, with a reason (kept on record). */
  editStart: (id: string, newStartIso: string, reason: string) => Promise<void>;
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
      .select('*, profiles!chicken_marinations_actor_id_fkey(name), unloader:profiles!chicken_marinations_unloaded_by_fkey(name)')
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
        p_remind: input.remind ?? false,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const markUnloaded = useCallback<ChickenContextValue['markUnloaded']>(
    async (id, photoUrl, countOut) => {
      const { error } = await supabase.rpc('set_chicken_unloaded', {
        p_id: id, p_photo_url: photoUrl, p_count_out: countOut ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const editStart = useCallback<ChickenContextValue['editStart']>(
    async (id, newStartIso, reason) => {
      const { error } = await supabase.rpc('edit_marination_start', { p_id: id, p_new_start: newStartIso, p_reason: reason });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ records, loading, refresh, submit, markUnloaded, editStart }),
    [records, loading, refresh, submit, markUnloaded, editStart]
  );
  return <ChickenContext.Provider value={value}>{children}</ChickenContext.Provider>;
}

export function useChicken(): ChickenContextValue {
  const ctx = useContext(ChickenContext);
  if (!ctx) throw new Error('useChicken must be used within ChickenProvider');
  return ctx;
}
