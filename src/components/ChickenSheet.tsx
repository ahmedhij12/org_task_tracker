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
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
// Turns "14:30" into today's ISO timestamp; returns null if malformed.
function toIso(time: string): string | null {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const d = new Date();
  d.setHours(h, mi, 0, 0);
  return d.toISOString();
}

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
  const [unloadTime, setUnloadTime] = useState(hhmm(new Date()));
  const [countOut, setCountOut] = useState('');
  const [note, setNote] = useState('');
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBranchId(myBranches[0]?.id ?? null); setMarinTime(hhmm(new Date())); setCountIn('');
    setHasUnload(false); setUnloadTime(hhmm(new Date())); setCountOut(''); setNote(''); setSignatureSvg(null); setError(null);
  };
  const handleClose = () => { if (submitting) return; reset(); onClose(); };

  const canSubmit = !!branchId && !!toIso(marinTime) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !branchId) return;
    const marinatedAt = toIso(marinTime);
    if (!marinatedAt) { setError(t('chicken.badTime')); return; }
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
        teamId: branchId, marinatedAt, countIn: countIn.trim() === '' ? null : Number(countIn),
        unloadedAt: hasUnload ? toIso(unloadTime) : null, countOut: hasUnload && countOut.trim() !== '' ? Number(countOut) : null,
        note: note.trim() || null, signatureUrl, isAudit: !!isAudit,
      });
      reset(); onClose();
    } catch (e: any) {
      setError(e?.message ?? t('chicken.submitFailed'));
      setSubmitting(false);
    }
  };

  const field = (label: string, value: string, setter: (v: string) => void, kind: 'time' | 'num') => (
    <View style={{ flex: 1 }}>
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
                    const active = branchId === tm.id;
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
                {field(t('chicken.time'), marinTime, setMarinTime, 'time')}
                {field(t('chicken.countIn'), countIn, setCountIn, 'num')}
              </View>

              <Pressable onPress={() => setHasUnload((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Ionicons name={hasUnload ? 'checkbox' : 'square-outline'} size={22} color={hasUnload ? c.brand : c.textMuted} />
                <Text style={{ fontSize: 14, color: c.text }}>{t('chicken.addUnload')}</Text>
              </Pressable>
              {hasUnload ? (
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
                  {field(t('chicken.unloadTime'), unloadTime, setUnloadTime, 'time')}
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
