import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { decode } from 'base64-arraybuffer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { resizeImage } from '@/lib/resizeImage';
import { useAuth } from '@/hooks/useAuth';
import { useOilTests } from '@/hooks/useOilTests';
import { readTesterPhoto, gradeForTpm } from '@/lib/oilOcr';
import { PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';
import type { OilFryer, OilGrade } from '@/types';

const GRADE_HEX: Record<OilGrade, string> = { good: '#10B981', watch: '#F59E0B', change: '#E8141A' };

export function OilTestSheet({ visible, isAudit, onClose }: { visible: boolean; isAudit?: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { fryers, submitTest } = useOilTests();

  const [fryerId, setFryerId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [tpm, setTpm] = useState('');
  const [temp, setTemp] = useState('');
  const [filtered, setFiltered] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [minutesLate, setMinutesLate] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), [visible]);

  // Ask the server which scheduled slot this moment belongs to, so the person
  // is told they're late before they fill anything in — not after.
  useEffect(() => {
    if (!visible || !fryerId || isAudit) { setMinutesLate(null); return; }
    const fryer = fryers.find((f) => f.id === fryerId);
    if (!fryer) return;
    let cancelled = false;
    supabase
      .rpc('oil_slot_for', { p_team_id: fryer.teamId, p_at: new Date().toISOString() })
      .then(({ data }) => {
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        setMinutesLate(row?.minutes_late ?? null);
      });
    return () => { cancelled = true; };
  }, [visible, fryerId, isAudit, fryers]);
  const tpmNum = tpm.trim() === '' ? null : Number(tpm);
  const grade: OilGrade | null = tpmNum != null && isFinite(tpmNum) ? gradeForTpm(tpmNum) : null;

  const reset = () => {
    setFryerId(null); setPhoto(null); setTpm(''); setTemp(''); setFiltered(null);
    setNote(''); setError(null); setReading(false); setLateReason(''); setMinutesLate(null);
  };
  const handleClose = () => { if (submitting) return; reset(); onClose(); };

  const takePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError(t('oil.cameraNeeded')); return; }
    try {
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
      if (result.canceled || !result.assets[0]?.base64) return;
      const shot = { uri: result.assets[0].uri, base64: await resizeImage(result.assets[0].base64) };
      setPhoto(shot);
      // Best-effort auto-read; the numbers stay editable no matter what it returns.
      setReading(true);
      try {
        const r = await readTesterPhoto(shot.base64, 'image/jpeg');
        if (r.tpm != null) setTpm(String(r.tpm));
        if (r.tempC != null) setTemp(String(r.tempC));
      } catch { /* silent — user types the numbers */ }
      setReading(false);
    } catch (e: any) {
      setError(e?.message ?? t('oil.cameraFailed'));
      setReading(false);
    }
  };

  const canSubmit =
    !!fryerId && !!photo && tpmNum != null && isFinite(tpmNum) && filtered != null && !submitting &&
    (minutesLate == null || lateReason.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit || !photo || !fryerId || tpmNum == null) return;
    setError(null);
    setSubmitting(true);
    try {
      const orgId = profile?.orgId;
      const path = `${orgId}/oil-${fryerId}-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('task-proofs').upload(path, decode(photo.base64), { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('task-proofs').getPublicUrl(path);

      await submitTest({
        fryerId, tpm: tpmNum, tempC: temp.trim() === '' ? null : Number(temp),
        filtered: filtered === true, photoUrl: pub.publicUrl, signatureUrl: null, note: note.trim() || null,
        lateReason: lateReason.trim() || null,
        isAudit: !!isAudit,
      });
      reset();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? t('oil.submitFailed'));
      setSubmitting(false);
    }
  };

  const timeLabel = now.toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '94%', flexShrink: 1 }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: Math.max(28, insets.bottom + 16), flexShrink: 1, minHeight: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{t('oil.title')}</Text>
              <Pressable onPress={handleClose} hitSlop={8}><Ionicons name="close" size={24} color={c.textMuted} /></Pressable>
            </View>
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>{timeLabel}</Text>

            <ScrollView style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled">
              {error ? <ErrorBanner message={error} /> : null}

              {/* Fryer picker */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>{t('oil.whichFryer')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                {fryers.map((f: OilFryer) => {
                  const active = fryerId === f.id;
                  return (
                    <Pressable key={f.id} onPress={() => setFryerId(f.id)}
                      style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: active ? c.brand : c.bgSubtle, borderWidth: 1, borderColor: active ? c.brand : c.border }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: active ? '#fff' : c.text }}>{f.name}</Text>
                    </Pressable>
                  );
                })}
                {fryers.length === 0 ? <Text style={{ fontSize: 13, color: c.textMuted }}>{t('oil.noFryers')}</Text> : null}
              </View>

              {/* Photo + auto-read */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>{t('oil.photo')}</Text>
              <Pressable onPress={takePhoto} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.bgSubtle, borderRadius: 14, padding: 12, marginBottom: 18 }}>
                {photo ? <Image source={{ uri: photo.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} /> : (
                  <View style={{ width: 72, height: 72, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="camera" size={28} color={c.textFaint} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: c.brand }}>{photo ? t('oil.retake') : t('oil.takePhoto')}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{reading ? t('oil.reading') : t('oil.photoHint')}</Text>
                </View>
                {reading ? <ActivityIndicator color={c.brand} /> : null}
              </Pressable>

              {/* TPM + temp (editable) with live color */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{t('oil.tpm')}</Text>
                  <TextInput value={tpm} onChangeText={setTpm} keyboardType="decimal-pad" placeholder="0.0" placeholderTextColor={c.textFaint}
                    style={{ borderWidth: 1, borderColor: grade ? GRADE_HEX[grade] : c.border, borderRadius: 12, padding: 12, fontSize: 20, fontWeight: '800', color: c.text }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{t('oil.temp')}</Text>
                  <TextInput value={temp} onChangeText={setTemp} keyboardType="decimal-pad" placeholder="°C" placeholderTextColor={c.textFaint}
                    style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 20, fontWeight: '800', color: c.text }} />
                </View>
              </View>
              {grade ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: GRADE_HEX[grade] + '22', borderRadius: 12, padding: 12, marginBottom: 18 }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: GRADE_HEX[grade] }} />
                  <Text style={{ fontSize: 14, fontWeight: '700', color: GRADE_HEX[grade] }}>{t(`oil.grade_${grade}`)}</Text>
                </View>
              ) : null}

              {/* Filtered Yes/No */}
              <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 }}>{t('oil.filtered')}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
                {/* Yes fills green, No fills red — same as the checklist. Both
                    must change on press: styling "No" like the untouched state
                    made the button look broken. */}
                {[{ v: true, l: t('oil.yes'), on: c.emerald }, { v: false, l: t('oil.no'), on: c.rose }].map((o) => {
                  const active = filtered === o.v;
                  return (
                    <Pressable key={String(o.v)} onPress={() => setFiltered(o.v)}
                      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: active ? o.on : c.bgSubtle, borderWidth: 1, borderColor: active ? o.on : c.border }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: active ? '#fff' : c.text }}>{o.l}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {minutesLate != null ? (
                <View style={{ backgroundColor: '#E8141A18', borderWidth: 1, borderColor: '#E8141A55', borderRadius: 12, padding: 12, marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Ionicons name="alert-circle" size={18} color="#E8141A" />
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#E8141A', flex: 1 }}>
                      {t('oil.lateBy', { count: minutesLate })}
                    </Text>
                  </View>
                  <TextInput value={lateReason} onChangeText={setLateReason} multiline
                    placeholder={t('oil.lateWhy')} placeholderTextColor={c.textFaint}
                    style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 10, fontSize: 14, color: c.text, minHeight: 44, backgroundColor: c.bg, textAlign: textAlignFor(lateReason) }} />
                </View>
              ) : null}

              {/* Optional note */}
              <TextInput value={note} onChangeText={setNote} placeholder={t('oil.notePlaceholder')} placeholderTextColor={c.textFaint} multiline
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, fontSize: 14, color: c.text, marginBottom: 18, minHeight: 44, textAlign: textAlignFor(note) }} />

              <View style={{ height: 4 }} />
            </ScrollView>

            {submitting ? (
              <View style={{ paddingVertical: 14, alignItems: 'center' }}><ActivityIndicator color={c.brand} /></View>
            ) : (
              <>
                <PrimaryButton title={t('oil.submit')} onPress={handleSubmit} disabled={!canSubmit} />
                <View style={{ height: 10 }} />
                <SecondaryButton title={t('oil.cancel')} onPress={handleClose} />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
