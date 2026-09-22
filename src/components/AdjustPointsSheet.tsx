import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, View, Text, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOrgData } from '@/hooks/useOrgData';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { PointsAdjustment, TaskCompletion } from '@/types';

interface Props {
  completion: TaskCompletion | null;
  /** Owner: any audit. Team_admin: only ones they personally performed — checked by the caller, matches adjust_completion_points itself. */
  canEdit: boolean;
  onClose: () => void;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtPoints(points: number, rate: number): string {
  return `${points} pts · ${Math.abs(points * rate).toLocaleString()} IQD`;
}

export function AdjustPointsSheet({ completion, canEdit, onClose }: Props) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { loadPointsAdjustments, adjustCompletionPoints } = useOrgData();

  const [adjustments, setAdjustments] = useState<PointsAdjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!completion) {
      setAdjustments([]);
      return;
    }
    setAmountText(String(Math.round((completion.pointsAwarded ?? 0) * completion.iqdPerPoint)));
    setError(null);
    setLoading(true);
    loadPointsAdjustments(completion.id)
      .then(setAdjustments)
      .catch((e) => setError(e?.message ?? t('pointsSheet.loadFailed')))
      .finally(() => setLoading(false));
  }, [completion?.id]);

  if (!completion) return null;

  const current = completion.pointsAwarded ?? 0;
  const original = adjustments.length > 0 ? adjustments[0].previousPoints ?? current : current;
  const wasAdjusted = adjustments.length > 0;

  const handleSave = async () => {
    const parsedAmount = Number(amountText);
    if (!Number.isFinite(parsedAmount)) {
      setError(t('pointsSheet.invalid'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adjustCompletionPoints(completion.id, parsedAmount / completion.iqdPerPoint);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? t('pointsSheet.saveFailed'));
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
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 2 }}>
              {canEdit ? t('pointsSheet.adjust') : t('pointsSheet.points')}
            </Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 16 }}>{completion.taskTitle}</Text>

            {error ? <ErrorBanner message={error} /> : null}

            {loading ? (
              <ActivityIndicator color={c.brand} style={{ marginVertical: 20 }} />
            ) : (
              <>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  <View style={{ flex: 1, backgroundColor: c.bgSubtle, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>{t('pointsSheet.original')}</Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{fmtPoints(original, completion.iqdPerPoint)}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: c.bgSubtle, borderRadius: 14, padding: 12 }}>
                    <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 4 }}>
                      {wasAdjusted ? t('pointsSheet.currentAdjusted') : t('pointsSheet.current')}
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: current < 0 ? c.rose : c.emerald }}>
                      {fmtPoints(current, completion.iqdPerPoint)}
                    </Text>
                  </View>
                </View>

                {adjustments.length > 0 ? (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: c.textMuted, marginBottom: 6 }}>{t('pointsSheet.history')}</Text>
                    {/* Capped so a long correction trail can't push Save/Close off-screen. */}
                    <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
                    {adjustments.map((a) => (
                      <Text key={a.id} style={{ fontSize: 12, color: c.textMuted, marginBottom: 3 }}>
                        {when(a.createdAt)} — {a.previousPoints != null ? Math.round(a.previousPoints * completion.iqdPerPoint).toLocaleString() : '—'} →{' '}
                        {Math.round(a.newPoints * completion.iqdPerPoint).toLocaleString()} IQD
                      </Text>
                    ))}
                    </ScrollView>
                  </View>
                ) : null}

                {canEdit ? (
                  <>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: c.text, marginBottom: 6 }}>{t('pointsSheet.newAmount')}</Text>
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
                      <ActivityIndicator color={c.brand} />
                    ) : (
                      <PrimaryButton title={t('pointsSheet.save')} onPress={handleSave} />
                    )}
                    <View style={{ height: 10 }} />
                  </>
                ) : null}
              </>
            )}

            <SecondaryButton title={t('pointsSheet.close')} onPress={onClose} disabled={saving} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
