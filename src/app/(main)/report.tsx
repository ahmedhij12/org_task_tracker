import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useReports } from '@/hooks/useReports';
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';
import { exportReportToExcel } from '@/lib/exportReport';
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
  const { periods, closeNextMonth, getPeriodReport } = useReports();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [rows, setRows] = useState<BranchSummaryRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? periods[0] ?? null;

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
    await exportReportToExcel(selectedPeriod, rows, i18n.language);
  };

  const totalPoints = rows.reduce((sum, r) => sum + r.totalPoints, 0);
  const totalIqd = rows.reduce((sum, r) => sum + r.iqdAmount, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 16 }}>{t('report.title')}</Text>

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
                      backgroundColor: active ? c.indigo : c.bgSubtle,
                      borderWidth: 1,
                      borderColor: active ? c.indigo : c.border,
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
                <Ionicons name="share-outline" size={16} color={c.indigo} />
                <Text style={{ fontSize: 13, color: c.indigo, fontWeight: '700' }}>{t('report.export')}</Text>
              </Pressable>
            </View>

            {rowsLoading ? (
              <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 12 }}>{t('report.loadingReport')}</Text>
            ) : (
              <Card style={{ marginTop: 12 }}>
                {rows.map((r) => (
                  <View
                    key={`${r.subjectProfileId}-${r.branchId}`}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: c.border,
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{r.subjectName}</Text>
                      <Text style={{ fontSize: 12, color: c.textMuted }}>{r.branchName}</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: r.totalPoints < 0 ? c.rose : c.emerald }}>
                      {r.totalPoints} · {r.iqdAmount.toLocaleString(i18n.language)}
                    </Text>
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
    </SafeAreaView>
  );
}
