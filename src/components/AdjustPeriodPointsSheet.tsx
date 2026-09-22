import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReports } from '@/hooks/useReports';
import { useAuth } from '@/hooks/useAuth';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { BranchSummaryRow, PeriodAdjustment } from '@/types';

interface Props {
  periodId: string;
  row: BranchSummaryRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtPoints(points: number, iqd: number): string {
  return `${points} pts · ${Math.abs(iqd).toLocaleString()} IQD`;
}

export function AdjustPeriodPointsSheet({ periodId, row, onClose, onSaved }: Props) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { loadPeriodAdjustments, adjustPeriodPoints } = useReports();
  // A new override is always converted at today's rate; get_period_report
  // then shows it back at that same stored rate, so the typed IQD sticks.
  const rate = useAuth().organization?.iqdPerPoint ?? 25000;

  const [adjustments, setAdjustments] = useState<PeriodAdjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) {
      setAdjustments([]);
      return;
    }
    setAmountText(String(Math.round(row.iqdAmount)));
    setError(null);
    setLoading(true);
    loadPeriodAdjustments(periodId, row.subjectProfileId)
      .then(setAdjustments)
      .catch((e) => setError(e?.message ?? 'Could not load the adjustment history.'))
      .finally(() => setLoading(false));
  }, [row?.subjectProfileId, periodId]);

  if (!row) return null;

  const current = row.totalPoints;
  const original = row.rawPoints ?? current;
  const wasAdjusted = adjustments.length > 0;

  const handleSave = async () => {
    const parsedAmount = Number(amountText);
    if (!Number.isFinite(parsedAmount)) {
      setError('Enter a valid amount.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adjustPeriodPoints(periodId, row.subjectProfileId, parsedAmount / rate);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save this adjustment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: Math.max(32, insets.bottom + 16),
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 2 }}>Adjust month total</Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 16 }}>{row.subjectName}</Text>

            {error ? <ErrorBanner message={error} /> : null}

            {loading ? (
              <ActivityIndicator color={c.indigo} style={{ marginVertical: 20 }} />
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  <View style={{ flex: 1, backgroundColor: c.bgSubtle, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>Original (natural sum)</Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{fmtPoints(original, row.rawIqdAmount ?? row.iqdAmount)}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: c.bgSubtle, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>
                      {wasAdjusted ? 'Current (adjusted)' : 'Current'}
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: current < 0 ? c.rose : c.emerald }}>
                      {fmtPoints(current, row.iqdAmount)}
                    </Text>
                  </View>
                </View>

                {adjustments.length > 0 ? (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: c.textMuted, marginBottom: 6 }}>History</Text>
                    {/* Capped so a long correction trail can't push Save/Close off-screen. */}
                    <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
                    {adjustments.map((a) => (
                      <Text key={a.id} style={{ fontSize: 12, color: c.textMuted, marginBottom: 3 }}>
                        {when(a.createdAt)} — {a.previousIqd != null ? Math.round(a.previousIqd).toLocaleString() : '—'} →{' '}
                        {Math.round(a.newPoints * a.iqdPerPoint).toLocaleString()} IQD
                      </Text>
                    ))}
                    </ScrollView>
                  </View>
                ) : null}

                <Text style={{ fontSize: 12, fontWeight: '600', color: c.text, marginBottom: 6 }}>New amount (IQD)</Text>
                <TextInput
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="numbers-and-punctuation"
                  placeholderTextColor={c.textFaint}
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 12,
                    padding: 12,
                    fontSize: 15,
                    color: c.text,
                    marginBottom: 16,
                  }}
                />
                {saving ? (
                  <ActivityIndicator color={c.indigo} />
                ) : (
                  <PrimaryButton title="Save" onPress={handleSave} />
                )}
                <View style={{ height: 10 }} />
              </>
            )}

            <SecondaryButton title="Close" onPress={onClose} disabled={saving} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
