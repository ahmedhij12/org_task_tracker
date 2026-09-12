import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { BranchSummaryRow, ReportPeriod } from '../types';

function mapPeriod(row: any): ReportPeriod {
  return {
    id: row.id,
    orgId: row.org_id,
    periodMonth: row.period_month,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

function mapSummaryRow(row: any): BranchSummaryRow {
  return {
    branchId: row.branch_id,
    branchName: row.branch_name,
    subjectProfileId: row.subject_profile_id,
    subjectName: row.subject_name,
    totalPoints: Number(row.total_points),
    iqdAmount: Number(row.iqd_amount),
  };
}

export function useReports() {
  const { organization } = useAuth();
  const [periods, setPeriods] = useState<ReportPeriod[]>([]);
  const [currentSummary, setCurrentSummary] = useState<BranchSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!organization) {
      setPeriods([]);
      setCurrentSummary([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [periodsRes, summaryRes] = await Promise.all([
      supabase
        .from('report_periods')
        .select('*')
        .eq('org_id', organization.id)
        .order('period_month', { ascending: false }),
      supabase.rpc('get_current_branch_summary'),
    ]);
    if (!periodsRes.error) setPeriods((periodsRes.data ?? []).map(mapPeriod));
    if (!summaryRes.error) setCurrentSummary((summaryRes.data ?? []).map(mapSummaryRow));
    setLoading(false);
  }, [organization]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const closeNextMonth = useCallback(async () => {
    const { data, error } = await supabase.rpc('close_next_month');
    if (error) throw error;
    await refresh();
    const row = data?.[0];
    return row ? { periodId: row.period_id as string, periodMonth: row.period_month as string } : null;
  }, [refresh]);

  const getPeriodReport = useCallback(async (periodId: string): Promise<BranchSummaryRow[]> => {
    const { data, error } = await supabase.rpc('get_period_report', { p_period_id: periodId });
    if (error) throw error;
    return (data ?? []).map(mapSummaryRow);
  }, []);

  return { periods, currentSummary, loading, refresh, closeNextMonth, getPeriodReport };
}
