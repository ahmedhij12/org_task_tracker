import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { TimeField } from '@/components/TimeField';
import { correctedStartIso, timeOf } from '@/lib/time';
import { textAlignFor } from '@/lib/rtl';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { ChickenMarination } from '@/types';

/** "HH:MM" of an instant in the branch's own clock. */
function hhmmAt(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

/**
 * The branch manager corrects when a batch went into the vinegar — the
 * supervisor forgot to record it at the time (his rule, 2026-09-26: the start
 * is the server's clock; only the manager may move it, and never without a
 * reason). The admin and the auditor see who moved it, from when, and why.
 */
export function EditMarinationStartSheet({ batch, onClose }: { batch: ChickenMarination | null; onClose: () => void }) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { editStart } = useChicken();
  const { teams } = useOrgData();
  const tz = teams.find((tm) => tm.id === batch?.teamId)?.timezone ?? 'Asia/Baghdad';
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batch) return;
    setTime(hhmmAt(batch.marinatedAt, tz));
    setReason('');
    setError(null);
  }, [batch?.id]);

  if (!batch) return null;

  // The chosen time on the batch's own day (the day before when that is still ahead).
  const newIso = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? correctedStartIso(batch.originalMarinatedAt ?? batch.marinatedAt, time, tz) : null;
  const problem = !newIso
    ? null
    : new Date(newIso).getTime() > Date.now()
      ? t('chicken.errFutureMarinated')
      : batch.unloadedAt && new Date(newIso).getTime() >= new Date(batch.unloadedAt).getTime()
        ? t('chicken.errStartAfterOut')
        : null;
  const canSave = !!newIso && !problem && reason.trim().length > 0 && !busy;

  const save = async () => {
    if (!canSave || !newIso) return;
    setBusy(true);
    setError(null);
    try {
      await editStart(batch.id, newIso, reason.trim());
      onClose();
    } catch (e: any) {
      setError(e?.message ?? t('chicken.submitFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{t('chicken.editStartTitle')}</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t('common.cancel')}>
                <Ionicons name="close" size={24} color={c.textMuted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, color: c.textMuted, lineHeight: 19 }}>
              {t('chicken.editStartHint', { time: timeOf(batch.originalMarinatedAt ?? batch.marinatedAt, i18n.language, tz) })}
            </Text>
            {error ? <ErrorBanner message={error} /> : null}
            <View style={{ flexDirection: 'row' }}>
              <TimeField label={t('chicken.editStartNewTime')} value={time} onChange={setTime} />
            </View>
            {problem ? <Text style={{ fontSize: 12, color: c.rose }}>{problem}</Text> : null}
            <TextInput
              testID="edit-start-reason"
              value={reason}
              onChangeText={setReason}
              placeholder={t('chicken.editStartReason')}
              placeholderTextColor={c.textFaint}
              multiline
              style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 14, color: c.text, minHeight: 60, textAlign: textAlignFor(reason) }}
            />
            <PrimaryButton title={t('chicken.editStartSave')} onPress={save} loading={busy} disabled={!canSave} />
            <SecondaryButton title={t('chicken.cancel')} onPress={onClose} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
