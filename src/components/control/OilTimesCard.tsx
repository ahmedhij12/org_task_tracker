import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { TimeField } from '@/components/TimeField';
import { Card, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { SettingRow, parseSetting } from '@/components/control/SettingRow';

type Slot = { id: string; at: string }; // at = 'HH:MM'

/** "14:00" → "2:00 PM" (branch time — every branch keeps its own clock). */
function label(at: string, locale: string): string {
  const [h, m] = at.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * The oil test times, company-wide, and the grace after each. A change
 * reaches every branch and the reminders at once; past tests keep the time
 * they were recorded against.
 */
export function OilTimesCard() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { organization } = useAuth();
  const { settings, save, loaded } = useOrgSettings();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // slot id, or 'new'
  const [draft, setDraft] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [grace, setGrace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    const { data } = await supabase.from('oil_slots').select('id, at_time').eq('org_id', organization.id).order('at_time');
    setSlots((data ?? []).map((r: any) => ({ id: r.id, at: String(r.at_time).slice(0, 5) })));
  }, [organization?.id]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => PromiseLike<{ error: any }>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: e } = await fn();
      if (e) throw e;
      await load();
      setEditing(null);
      setConfirmRemove(null);
      setNotice(done);
    } catch (e: any) {
      setError(e?.message ?? t('control.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft);
  const saveTime = () => {
    if (!validTime) return;
    run(() => supabase.rpc('set_oil_slot', { p_slot_id: editing === 'new' ? null : editing, p_at_time: draft }), t('control.oilTimeSaved', { time: label(draft, i18n.language) }));
  };
  const remove = (s: Slot) => run(() => supabase.rpc('remove_oil_slot', { p_slot_id: s.id }), t('control.oilTimeRemoved', { time: label(s.at, i18n.language) }));

  const g = grace == null ? settings.oilGraceMin : parseSetting(grace, 0, 180);
  const saveGrace = async () => {
    if (g == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await save({ oilGraceMin: g });
      setGrace(null);
      setNotice(t('control.saved'));
    } catch (e: any) {
      setError(e?.message ?? t('control.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>{t('control.oilTimesTitle')}</Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{t('control.oilTimesHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {slots.map((s) =>
        editing === s.id ? (
          <View key={s.id} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingVertical: 8 }}>
            <TimeField label={t('control.oilTimeChange')} value={draft} onChange={setDraft} />
            <Pressable onPress={saveTime} disabled={!validTime || busy} style={{ backgroundColor: c.brand, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, opacity: !validTime || busy ? 0.45 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{t('control.save')}</Text>
            </Pressable>
            <Pressable onPress={() => setEditing(null)} hitSlop={8} style={{ paddingVertical: 14 }}>
              <Ionicons name="close" size={20} color={c.textMuted} />
            </Pressable>
          </View>
        ) : (
          <View key={s.id} testID={`oil-slot-${s.at}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <Ionicons name="thermometer-outline" size={18} color={c.brand} />
            <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: c.text }}>{label(s.at, i18n.language)}</Text>
            {confirmRemove === s.id ? (
              <Pressable onPress={() => remove(s)} disabled={busy} style={{ backgroundColor: c.rose, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{t('control.oilTimeConfirmRemove')}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable onPress={() => { setEditing(s.id); setDraft(s.at); setConfirmRemove(null); }} hitSlop={8} accessibilityLabel={t('control.oilTimeChange')}>
                  <Ionicons name="create-outline" size={20} color={c.textMuted} />
                </Pressable>
                <Pressable onPress={() => setConfirmRemove(s.id)} hitSlop={8} accessibilityLabel={t('control.oilTimeRemove')}>
                  <Ionicons name="trash-outline" size={19} color={c.rose} />
                </Pressable>
              </>
            )}
          </View>
        ),
      )}

      {editing === 'new' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingVertical: 8 }}>
          <TimeField label={t('control.oilTimeAdd')} value={draft} onChange={setDraft} />
          <Pressable onPress={saveTime} disabled={!validTime || busy} style={{ backgroundColor: c.brand, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14, opacity: !validTime || busy ? 0.45 : 1 }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('control.add')}</Text>}
          </Pressable>
          <Pressable onPress={() => setEditing(null)} hitSlop={8} style={{ paddingVertical: 14 }}>
            <Ionicons name="close" size={20} color={c.textMuted} />
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => { setEditing('new'); setDraft(''); setConfirmRemove(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 }}>
          <Ionicons name="add-circle-outline" size={20} color={c.brand} />
          <Text style={{ color: c.brand, fontWeight: '700' }}>{t('control.oilTimeAdd')}</Text>
        </Pressable>
      )}

      <SettingRow label={t('control.oilGrace')} hint={t('control.oilGraceHint')} value={settings.oilGraceMin} unit={t('control.unitMin')} onChange={setGrace} />
      {notice ? <Text style={{ fontSize: 12, color: c.brand, marginTop: 8 }}>{notice}</Text> : null}
      {grace != null ? (
        <View style={{ marginTop: 12 }}>
          <PrimaryButton title={t('control.save')} onPress={saveGrace} loading={busy} disabled={g == null || !loaded} />
        </View>
      ) : null}
    </Card>
  );
}
