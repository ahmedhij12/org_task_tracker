import { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { TimeField } from '@/components/TimeField';
import { isoForBranchTime } from '@/lib/time';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';

const CHICKENS_PER_BUCKET = 8;

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function ChickenSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { teams } = useOrgData();
  const { submit } = useChicken();
  const { width, height } = useWindowDimensions();
  // Two number boxes side by side do not fit a narrow phone, and the whole
  // sheet has to breathe less on a short one.
  const narrow = width < 360;
  const tight = height < 700;
  const gapY = tight ? 8 : 14;

  const myBranches = useMemo(() => (profile?.role === 'owner' ? teams : teams.filter((tm) => profile?.teamIds.includes(tm.id))), [teams, profile]);
  const [branchId, setBranchId] = useState<string | null>(myBranches[0]?.id ?? null);
  const [marinTime, setMarinTime] = useState(hhmm(new Date()));
  const [countIn, setCountIn] = useState('');
  const [remind, setRemind] = useState(true);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBranchId(myBranches[0]?.id ?? null); setMarinTime(hhmm(new Date())); setCountIn('');
    setRemind(true); setNote(''); setError(null);
  };
  const handleClose = () => { if (submitting) return; reset(); onClose(); };

  // teams can arrive after this sheet mounts, so never trust the initial pick alone.
  const effectiveBranchId = branchId ?? myBranches[0]?.id ?? null;
  const tz = teams.find((tm) => tm.id === effectiveBranchId)?.timezone ?? 'Asia/Baghdad';

  // Both times are typed by hand, so both can describe something that has not
  // happened. A batch recorded as "in at 1 PM, out at 4 PM" at 1:47 PM is not a
  // record of anything — and the monitor used to call it "Removed on time".
  const timeProblem = useMemo(() => {
    const marinated = new Date(isoForBranchTime(marinTime, tz)).getTime();
    return marinated > Date.now() ? t('chicken.errFutureMarinated') : null;
  }, [marinTime, tz, t]);

  const canSubmit = !!effectiveBranchId && !submitting && !timeProblem;

  const handleSubmit = async () => {
    if (!canSubmit || !effectiveBranchId) return;
    const marinatedAt = isoForBranchTime(marinTime, tz);
    setError(null); setSubmitting(true);
    try {
      await submit({
        teamId: effectiveBranchId, marinatedAt, countIn: countIn.trim() === '' ? null : Number(countIn),
        unloadedAt: null, countOut: null,
        note: note.trim() || null, signatureUrl: null, remind,
      });
      reset(); onClose();
    } catch (e: any) {
      setError(e?.message ?? t('chicken.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const field = (label: string, value: string, setter: (v: string) => void, kind: 'time' | 'num') => (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{label}</Text>
      <TextInput value={value} onChangeText={setter} keyboardType={kind === 'num' ? 'decimal-pad' : 'numbers-and-punctuation'}
        placeholder={kind === 'time' ? 'HH:MM' : '0'} placeholderTextColor={c.textFaint}
        style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 17, fontWeight: '700', color: c.text }} />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '94%', flexShrink: 1 }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: tight ? 14 : 20, paddingBottom: Math.max(tight ? 18 : 28, insets.bottom + 12), flexShrink: 1, minHeight: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: gapY }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{t('chicken.title')}</Text>
              <Pressable onPress={handleClose} hitSlop={8}><Ionicons name="close" size={24} color={c.textMuted} /></Pressable>
            </View>

            <ScrollView style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled">
              {error ? <ErrorBanner message={error} /> : null}

              {myBranches.length > 1 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: gapY }}>
                  {myBranches.map((tm) => {
                    const active = effectiveBranchId === tm.id;
                    return (
                      <Pressable key={tm.id} onPress={() => setBranchId(tm.id)}
                        style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: active ? c.brand : c.bgSubtle, borderWidth: 1, borderColor: active ? c.brand : c.border }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: active ? '#fff' : c.text }}>{tm.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>{t('chicken.marinationHeading')}</Text>
              <View style={{ flexDirection: narrow ? 'column' : 'row', gap: narrow ? 10 : 12, marginBottom: 6 }}>
                <TimeField label={t('chicken.time')} value={marinTime} onChange={setMarinTime} />
                {field(t('chicken.countIn'), countIn, setCountIn, 'num')}
              </View>
              {Number(countIn) > 0 ? (
                <Text style={{ fontSize: 12, color: c.brand, fontWeight: '700', marginBottom: 14 }}>
                  {t('chicken.bucketMath', { buckets: Number(countIn), chickens: Number(countIn) * CHICKENS_PER_BUCKET })}
                </Text>
              ) : <View style={{ height: 12 }} />}

              <Pressable onPress={() => setRemind((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: gapY, backgroundColor: c.bgSubtle, borderRadius: 12, padding: tight ? 10 : 12 }}>
                <Ionicons name={remind ? 'notifications' : 'notifications-off-outline'} size={20} color={remind ? c.brand : c.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{t('chicken.remindMe')}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>{t('chicken.remindHint')}</Text>
                </View>
                <Ionicons name={remind ? 'checkbox' : 'square-outline'} size={22} color={remind ? c.brand : c.textMuted} />
              </Pressable>

              <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: gapY, lineHeight: 18 }}>{t('chicken.removalLater')}</Text>

              <TextInput value={note} onChangeText={setNote} placeholder={t('chicken.notePlaceholder')} placeholderTextColor={c.textFaint} multiline
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 14, color: c.text, marginBottom: gapY, minHeight: 44, textAlign: textAlignFor(note) }} />

            </ScrollView>

            {timeProblem ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                <Ionicons name="alert-circle" size={16} color={c.rose} style={{ marginTop: 1 }} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: c.rose, flex: 1 }}>{timeProblem}</Text>
              </View>
            ) : null}

            {submitting ? (
              <View style={{ paddingVertical: 14, alignItems: 'center' }}><ActivityIndicator color={c.brand} /></View>
            ) : (
              <>
                <PrimaryButton title={t('chicken.submit')} onPress={handleSubmit} disabled={!canSubmit} />
                <View style={{ height: 10 }} />
                <SecondaryButton title={t('chicken.cancel')} onPress={handleClose} />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
