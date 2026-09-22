import { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { SignaturePad } from '@/components/SignaturePad';
import { TimeField } from '@/components/TimeField';
import { isoForBranchTime } from '@/lib/time';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function ChickenSheet({ visible, isAudit, onClose }: { visible: boolean; isAudit?: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { teams } = useOrgData();
  const { submit } = useChicken();

  const myBranches = useMemo(() => (profile?.role === 'owner' ? teams : teams.filter((tm) => profile?.teamIds.includes(tm.id))), [teams, profile]);
  const [branchId, setBranchId] = useState<string | null>(myBranches[0]?.id ?? null);
  const [marinTime, setMarinTime] = useState(hhmm(new Date()));
  const [countIn, setCountIn] = useState('');
  const [hasUnload, setHasUnload] = useState(false);
  const [remind, setRemind] = useState(true);
  const [unloadTime, setUnloadTime] = useState(hhmm(new Date()));
  const [countOut, setCountOut] = useState('');
  const [note, setNote] = useState('');
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBranchId(myBranches[0]?.id ?? null); setMarinTime(hhmm(new Date())); setCountIn('');
    setHasUnload(false); setRemind(true); setUnloadTime(hhmm(new Date())); setCountOut(''); setNote(''); setSignatureSvg(null); setError(null);
  };
  const handleClose = () => { if (submitting) return; reset(); onClose(); };

  // teams can arrive after this sheet mounts, so never trust the initial pick alone.
  const effectiveBranchId = branchId ?? myBranches[0]?.id ?? null;
  const canSubmit = !!effectiveBranchId && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !effectiveBranchId) return;
    const tz = teams.find((tm) => tm.id === effectiveBranchId)?.timezone ?? 'Asia/Baghdad';
    const marinatedAt = isoForBranchTime(marinTime, tz);
    setError(null); setSubmitting(true);
    try {
      let signatureUrl: string | null = null;
      if (signatureSvg) {
        const path = `${profile?.orgId}/chicken-sig-${Date.now()}.svg`;
        const { error: e } = await supabase.storage.from('task-proofs').upload(path, new TextEncoder().encode(signatureSvg), { contentType: 'image/svg+xml' });
        if (e) throw e;
        signatureUrl = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      }
      await submit({
        teamId: effectiveBranchId, marinatedAt, countIn: countIn.trim() === '' ? null : Number(countIn),
        unloadedAt: hasUnload ? isoForBranchTime(unloadTime, tz) : null, countOut: hasUnload && countOut.trim() !== '' ? Number(countOut) : null,
        note: note.trim() || null, signatureUrl, isAudit: !!isAudit, remind,
      });
      reset(); onClose();
    } catch (e: any) {
      setError(e?.message ?? t('chicken.submitFailed'));
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
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: Math.max(28, insets.bottom + 16), flexShrink: 1, minHeight: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{t('chicken.title')}</Text>
              <Pressable onPress={handleClose} hitSlop={8}><Ionicons name="close" size={24} color={c.textMuted} /></Pressable>
            </View>

            <ScrollView style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled">
              {error ? <ErrorBanner message={error} /> : null}

              {myBranches.length > 1 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
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
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
                <TimeField label={t('chicken.time')} value={marinTime} onChange={setMarinTime} />
                {field(t('chicken.countIn'), countIn, setCountIn, 'num')}
              </View>

              <Pressable onPress={() => setRemind((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, backgroundColor: c.bgSubtle, borderRadius: 12, padding: 12 }}>
                <Ionicons name={remind ? 'notifications' : 'notifications-off-outline'} size={20} color={remind ? c.brand : c.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{t('chicken.remindMe')}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>{t('chicken.remindHint')}</Text>
                </View>
                <Ionicons name={remind ? 'checkbox' : 'square-outline'} size={22} color={remind ? c.brand : c.textMuted} />
              </Pressable>

              <Pressable onPress={() => setHasUnload((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Ionicons name={hasUnload ? 'checkbox' : 'square-outline'} size={22} color={hasUnload ? c.brand : c.textMuted} />
                <Text style={{ fontSize: 14, color: c.text }}>{t('chicken.addUnload')}</Text>
              </Pressable>
              {hasUnload ? (
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
                  <TimeField label={t('chicken.unloadTime')} value={unloadTime} onChange={setUnloadTime} />
                  {field(t('chicken.countOut'), countOut, setCountOut, 'num')}
                </View>
              ) : null}

              <TextInput value={note} onChangeText={setNote} placeholder={t('chicken.notePlaceholder')} placeholderTextColor={c.textFaint} multiline
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 14, color: c.text, marginBottom: 18, minHeight: 44, textAlign: textAlignFor(note) }} />

              <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>{t('chicken.signOptional')}</Text>
              <SignaturePad onChange={setSignatureSvg} />
              <View style={{ height: 8 }} />
            </ScrollView>

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
