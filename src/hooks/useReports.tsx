import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { BranchSummaryRow, PeriodAdjustment, ReportPeriod } from '../types';

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
    brandId: row.brand_id,
    brandName: row.brand_name,
    subjectProfileId: row.subject_profile_id,
    subjectName: row.subject_name,
    totalPoints: Number(row.total_points),
    iqdAmount: Number(row.iqd_amount),
    rawPoints: row.raw_points != null ? Number(row.raw_points) : undefined,
    rawIqdAmount: row.raw_iqd_amount != null ? Number(row.raw_iqd_amount) : undefined,
    scoreSum: row.score_sum != null ? Number(row.score_sum) : undefined,
    scoreCount: row.score_count != null ? Number(row.score_count) : undefined,
  };
}

function mapPeriodAdjustment(row: any): PeriodAdjustment {
  return {
    id: row.id,
    periodId: row.period_id,
    subjectProfileId: row.subject_profile_id,
    previousPoints: row.previous_points,
    newPoints: row.new_points,
    iqdPerPoint: Number(row.iqd_per_point),
    previousIqd: row.previous_iqd != null ? Number(row.previous_iqd) : null,
    adjustedBy: row.adjusted_by,
    reason: row.reason,
    createdAt: row.created_at,
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

  /** subjectProfileId -> consecutive negative months, counting back from the current live month. Owner only. */
  const loadSupervisorStreaks = useCallback(async (): Promise<Map<string, number>> => {
    const { data, error } = await supabase.rpc('get_supervisor_streaks');
    if (error) throw error;
    return new Map((data ?? []).map((row: any) => [row.subject_profile_id as string, Number(row.negative_streak)]));
  }, []);

  const loadPeriodAdjustments = useCallback(async (periodId: string, subjectProfileId: string): Promise<PeriodAdjustment[]> => {
    const { data, error } = await supabase
      .from('period_adjustments')
      .select('*')
      .eq('period_id', periodId)
      .eq('subject_profile_id', subjectProfileId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapPeriodAdjustment);
  }, []);

  const adjustPeriodPoints = useCallback(
    async (periodId: string, subjectProfileId: string, newPoints: number, reason?: string) => {
      const { error } = await supabase.rpc('adjust_period_points', {
        p_period_id: periodId,
        p_subject_profile_id: subjectProfileId,
        p_new_points: newPoints,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    []
  );

  return {
    periods,
    currentSummary,
    loading,
    refresh,
    closeNextMonth,
    getPeriodReport,
    loadPeriodAdjustments,
    adjustPeriodPoints,
    loadSupervisorStreaks,
  };
}
