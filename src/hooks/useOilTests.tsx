import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { OilFryer, OilTest } from '../types';

function mapFryer(row: any): OilFryer {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    name: row.name,
    sortOrder: row.sort_order,
    archived: row.archived,
  };
}

function mapTest(row: any): OilTest {
  return {
    id: row.id,
    orgId: row.org_id,
    teamId: row.team_id,
    fryerId: row.fryer_id,
    fryerName: row.oil_fryers?.name,
    actorId: row.actor_id,
    actorName: row.profiles?.name,
    isAudit: row.is_audit,
    tpm: Number(row.tpm),
    tempC: row.temp_c == null ? null : Number(row.temp_c),
    filtered: row.filtered,
    grade: row.grade,
    slotTime: row.slot_time ?? null,
    minutesLate: row.minutes_late ?? null,
    lateReason: row.late_reason ?? null,
    photoUrl: row.photo_url,
    signatureUrl: row.signature_url,
    note: row.note,
    testedAt: row.tested_at,
  };
}

export interface SubmitOilTestInput {
  fryerId: string;
  tpm: number;
  tempC: number | null;
  filtered: boolean;
  photoUrl: string;
  signatureUrl?: string | null;
  note?: string | null;
  isAudit?: boolean;
  /** Required by the server when the test is past the grace window. */
  lateReason?: string | null;
}

interface OilTestsContextValue {
  fryers: OilFryer[];
  tests: OilTest[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Resolves to the new test's id, so the caller can offer to share it. */
  submitTest: (input: SubmitOilTestInput) => Promise<string>;
}

const OilTestsContext = createContext<OilTestsContextValue | undefined>(undefined);

export function OilTestsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [fryers, setFryers] = useState<OilFryer[]>([]);
  const [tests, setTests] = useState<OilTest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const [fryerRes, testRes] = await Promise.all([
      supabase.from('oil_fryers').select('*').eq('archived', false).order('sort_order'),
      supabase
        .from('oil_tests')
        .select('*, oil_fryers(name), profiles!oil_tests_actor_id_fkey(name)')
        .order('tested_at', { ascending: false })
        .limit(500),
    ]);
    if (!fryerRes.error) setFryers((fryerRes.data ?? []).map(mapFryer));
    if (!testRes.error) setTests((testRes.data ?? []).map(mapTest));
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel('oil-tests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oil_tests' }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, refresh]);

  const submitTest = useCallback<OilTestsContextValue['submitTest']>(
    async (input) => {
      const { data, error } = await supabase.rpc('submit_oil_test', {
        p_fryer_id: input.fryerId,
        p_tpm: input.tpm,
        p_temp_c: input.tempC,
        p_filtered: input.filtered,
        p_photo_url: input.photoUrl,
        p_signature_url: input.signatureUrl ?? null,
        p_note: input.note ?? null,
        p_is_audit: input.isAudit ?? false,
        p_late_reason: input.lateReason ?? null,
      });
      if (error) throw error;
      await refresh();
      return data as string;
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ fryers, tests, loading, refresh, submitTest }),
    [fryers, tests, loading, refresh, submitTest]
  );

  return <OilTestsContext.Provider value={value}>{children}</OilTestsContext.Provider>;
}

export function useOilTests(): OilTestsContextValue {
  const ctx = useContext(OilTestsContext);
  if (!ctx) throw new Error('useOilTests must be used within OilTestsProvider');
  return ctx;
}
