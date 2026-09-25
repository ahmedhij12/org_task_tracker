import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MenuButton } from '@/components/SideMenu';
import { useAuth } from '@/hooks/useAuth';
import { seesAllBranches } from '@/lib/roles';
import { useReports } from '@/hooks/useReports';
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';
import { exportReportToExcel } from '@/lib/exportReport';
import { logActivity } from '@/lib/activityLog';
import { groupBranchSummary } from '@/lib/branchSummary';
import { AdjustPeriodPointsSheet } from '@/components/AdjustPeriodPointsSheet';
import type { BranchSummaryRow, ReportPeriod } from '@/types';

function formatPeriodLabel(period: ReportPeriod, locale: string) {
  return new Date(period.periodMonth).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export default function ReportScreen() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { periods, closeNextMonth, getPeriodReport } = useReports();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [rows, setRows] = useState<BranchSummaryRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [adjustRow, setAdjustRow] = useState<BranchSummaryRow | null>(null);

  // The admin and the hygiene auditor work the monthly report.
  const isOwner = seesAllBranches(profile);
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? periods[0] ?? null;

  const reloadRows = () => {
    if (!selectedPeriod) return;
    setRowsLoading(true);
    getPeriodReport(selectedPeriod.id)
      .then(setRows)
      .finally(() => setRowsLoading(false));
  };

  useEffect(() => {
    if (!selectedPeriod) {
      setRows([]);
      return;
    }
    setRowsLoading(true);
    getPeriodReport(selectedPeriod.id)
      .then(setRows)
      .finally(() => setRowsLoading(false));
  }, [selectedPeriod?.id, getPeriodReport]);

  const handleClose = async () => {
    setClosing(true);
    setCloseError(null);
    try {
      const result = await closeNextMonth();
      if (!result) setCloseError(t('report.nothingToClose'));
    } catch (e: any) {
      setCloseError(e?.message ?? t('report.closeError'));
    } finally {
      setClosing(false);
    }
  };

  const handleExport = async () => {
    if (!selectedPeriod) return;
    logActivity(profile, 'export', 'month_report', { period: selectedPeriod.id });
    await exportReportToExcel(selectedPeriod, rows, i18n.language);
  };

  const totalPoints = rows.reduce((sum, r) => sum + r.totalPoints, 0);
  const totalIqd = rows.reduce((sum, r) => sum + r.iqdAmount, 0);
  const groups = useMemo(() => groupBranchSummary(rows), [rows]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <MenuButton />
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('report.title')}</Text>
        </View>

        <PrimaryButton title={t('report.closeMonth')} onPress={handleClose} loading={closing} />
        {closeError ? <Text style={{ color: c.rose, fontSize: 12, marginTop: 8 }}>{closeError}</Text> : null}

        {periods.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 20 }}>{t('report.noClosedMonths')}</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 20 }} contentContainerStyle={{ gap: 8 }}>
              {periods.map((p) => {
                const active = selectedPeriod?.id === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setSelectedPeriodId(p.id)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: active ? c.brand : c.bgSubtle,
                      borderWidth: 1,
                      borderColor: active ? c.brand : c.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>
                      {formatPeriodLabel(p, i18n.language)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase' }}>
                {t('report.tableHeading')}
              </Text>
              <Pressable onPress={handleExport} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="share-outline" size={16} color={c.brand} />
                <Text style={{ fontSize: 13, color: c.brand, fontWeight: '700' }}>{t('report.export')}</Text>
              </Pressable>
            </View>

            {rowsLoading ? (
              <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 12 }}>{t('report.loadingReport')}</Text>
            ) : (
              <Card style={{ marginTop: 12 }}>
                {groups.map((branch) => (
                  <View key={branch.branchId} style={{ marginBottom: 14 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: c.text, marginBottom: 6 }}>{branch.branchName}</Text>
                    {branch.brandGroups.length === 1 && branch.brandGroups[0].brandKey === '__unassigned__' ? (
                      <View style={{ marginBottom: 8 }}>
                        {branch.brandGroups[0].rows.map((r) => (
                          <SupervisorRow key={`${r.subjectProfileId}-${r.branchId}`} row={r} locale={i18n.language} canAdjust={isOwner} onAdjust={() => setAdjustRow(r)} />
                        ))}
                      </View>
                    ) : (
                      branch.brandGroups.map((bg) => (
                        <View key={bg.brandKey} style={{ marginBottom: 8 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                            {bg.brandName ?? t('common.unassignedBrand')}
                          </Text>
                          {bg.rows.map((r) => (
                            <SupervisorRow key={`${r.subjectProfileId}-${r.branchId}`} row={r} locale={i18n.language} canAdjust={isOwner} onAdjust={() => setAdjustRow(r)} />
                          ))}
                        </View>
                      ))
                    )}
                  </View>
                ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>{t('report.total')}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                    {totalPoints} · {totalIqd.toLocaleString(i18n.language)}
                  </Text>
                </View>
              </Card>
            )}
          </>
        )}
      </ScrollView>

      {selectedPeriod ? (
        <AdjustPeriodPointsSheet
          periodId={selectedPeriod.id}
          row={adjustRow}
          onClose={() => setAdjustRow(null)}
          onSaved={() => {
            setAdjustRow(null);
            reloadRows();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function SupervisorRow({
  row,
  locale,
  canAdjust,
  onAdjust,
}: {
  row: BranchSummaryRow;
  locale: string;
  canAdjust: boolean;
  onAdjust: () => void;
}) {
  const c = useThemeColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <Text style={{ fontSize: 14, color: c.text }}>{row.subjectName}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: row.totalPoints < 0 ? c.rose : c.emerald }}>
          {row.totalPoints} · {row.iqdAmount.toLocaleString(locale)}
        </Text>
        {canAdjust ? (
          <Pressable onPress={onAdjust} hitSlop={8}>
            <Ionicons name="pencil" size={14} color={c.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
