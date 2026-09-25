import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { resizeImage } from '@/lib/resizeImage';
import { useAuth } from '@/hooks/useAuth';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { timeOf } from '@/lib/time';
import { dueAt, humanSpan } from '@/lib/marination';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { useThemeColors } from '@/components/ui';
import { can, seesAllBranches } from '@/lib/roles';
import { EditMarinationStartSheet } from '@/components/EditMarinationStartSheet';
import type { ChickenMarination } from '@/types';

const CHICKENS_PER_BUCKET = 8;

/** Batches still marinating: how long is left, and the photo-backed removal.
 * The removal time is stamped by the server, so it can't be back-dated. */
export function ChickenActive() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { records, markUnloaded } = useChicken();
  const { teams, allMembers } = useOrgData();
  const { marinationRules } = useOrgSettings();
  const { profile } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [editing, setEditing] = useState<ChickenMarination | null>(null);

  // Re-render each minute so the countdown stays honest.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const active = useMemo(
    () => records.filter((r) => !r.unloadedAt).slice(0, 5),
    [records]
  );
  if (active.length === 0) return null;

  const tzOf = (teamId: string) => teams.find((tm) => tm.id === teamId)?.timezone ?? 'Asia/Baghdad';
  // The branch manager corrects a start the supervisor recorded late (his rule).
  const canEditStart = (r: ChickenMarination) =>
    can(profile, 'edit_marination_start') && (seesAllBranches(profile) || !!profile?.teamIds.includes(r.teamId));
  const nameOf = (id: string | null | undefined) => allMembers.find((m) => m.id === id)?.name ?? '';

  const removeNow = async (id: string) => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError(t('oil.cameraNeeded')); return; }
    try {
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
      if (shot.canceled || !shot.assets[0]?.base64) return;
      setBusyId(id);
      const small = await resizeImage(shot.assets[0].base64);
      const path = `${profile?.orgId}/chicken-unload-${id}-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('task-proofs').upload(path, decode(small), { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const url = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      await markUnloaded(id, url);
    } catch (e: any) {
      setError(e?.message ?? t('chicken.removeFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted, marginBottom: 8 }}>{t('chicken.activeTitle')}</Text>
      {error ? <Text style={{ fontSize: 12, color: c.rose, marginBottom: 8 }}>{error}</Text> : null}
      {active.map((r) => {
        const left = dueAt(r, marinationRules) - Date.now();
        const over = left < 0;
        return (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, marginBottom: 8, backgroundColor: over ? '#E8141A18' : c.bgSubtle, borderWidth: 1, borderColor: over ? '#E8141A55' : c.border }}>
            <Ionicons name={over ? 'alarm' : 'time-outline'} size={22} color={over ? '#E8141A' : c.brand} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: over ? '#E8141A' : c.text }}>
                {over ? t('chicken.overdue', { time: humanSpan(left) }) : t('chicken.dueIn', { time: humanSpan(left) })}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Text style={{ fontSize: 12, color: c.textMuted, flexShrink: 1 }}>
                  {timeOf(r.marinatedAt, i18n.language, tzOf(r.teamId))}
                  {r.countIn != null ? ` · ${t('chicken.bucketsChickens', { buckets: r.countIn, chickens: Math.round(r.countIn * CHICKENS_PER_BUCKET) })}` : ''}
                </Text>
                {canEditStart(r) ? (
                  <Pressable testID="edit-start" onPress={() => setEditing(r)} hitSlop={8} accessibilityLabel={t('chicken.editStartTitle')}>
                    <Ionicons name="create-outline" size={16} color={c.brand} />
                  </Pressable>
                ) : null}
              </View>
              {r.startEditedAt ? (
                <Text style={{ fontSize: 11, color: c.amber, marginTop: 2 }} numberOfLines={2}>
                  {t('chicken.startCorrected', { name: nameOf(r.startEditedBy), reason: r.startEditReason ?? '' })}
                </Text>
              ) : null}
            </View>
            {busyId === r.id ? <ActivityIndicator color={c.brand} /> : (
              <Pressable onPress={() => removeNow(r.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: over ? '#E8141A' : c.brand, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Ionicons name="camera" size={15} color="#fff" />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{t('chicken.removeNow')}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      <Text style={{ fontSize: 11, color: c.textFaint }}>{t('chicken.removePhotoHint')}</Text>
      <EditMarinationStartSheet batch={editing} onClose={() => setEditing(null)} />
    </View>
  );
}
