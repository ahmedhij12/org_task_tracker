import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { timeOf } from '@/lib/time';
import { useThemeColors } from '@/components/ui';

const MARINATION_HOURS = 3;

function human(ms: number): string {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Batches still marinating: how long is left, and the photo-backed removal.
 * The removal time is stamped by the server, so it can't be back-dated. */
export function ChickenActive() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { records, markUnloaded } = useChicken();
  const { teams } = useOrgData();
  const { profile } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

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

  const removeNow = async (id: string) => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError(t('oil.cameraNeeded')); return; }
    try {
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
      if (shot.canceled || !shot.assets[0]?.base64) return;
      setBusyId(id);
      const path = `${profile?.orgId}/chicken-unload-${id}-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('task-proofs').upload(path, decode(shot.assets[0].base64), { contentType: 'image/jpeg' });
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
        const due = new Date(r.remindAt ?? new Date(new Date(r.marinatedAt).getTime() + MARINATION_HOURS * 3600000)).getTime();
        const left = due - Date.now();
        const over = left < 0;
        return (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, marginBottom: 8, backgroundColor: over ? '#E8141A18' : c.bgSubtle, borderWidth: 1, borderColor: over ? '#E8141A55' : c.border }}>
            <Ionicons name={over ? 'alarm' : 'time-outline'} size={22} color={over ? '#E8141A' : c.brand} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: over ? '#E8141A' : c.text }}>
                {over ? t('chicken.overdue', { time: human(left) }) : t('chicken.dueIn', { time: human(left) })}
              </Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                {timeOf(r.marinatedAt, i18n.language, tzOf(r.teamId))}
                {r.countIn != null ? ` · ${t('chicken.inN', { count: r.countIn })}` : ''}
              </Text>
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
    </View>
  );
}
