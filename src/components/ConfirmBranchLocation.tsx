import { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { PrimaryButton, useThemeColors } from '@/components/ui';

const MAX_ACCURACY_M = 100; // matches max_location_accuracy_m() on the server

/**
 * Asks the first staff member at a branch to confirm where the branch is,
 * while they are standing in it — their GPS is accurate there, unlike an admin
 * pinning a map from head office. Set once; the owner can re-pin later.
 */
export function ConfirmBranchLocation() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { refresh } = useOrgData();
  const [pending, setPending] = useState<{ team_id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    if (!profile || profile.role === 'owner') return;
    const { data } = await supabase.rpc('my_branches_needing_location');
    setPending(Array.isArray(data) ? data : []);
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const branch = pending[0];
  if (!branch || dismissed) return null;

  const confirm = async () => {
    setBusy(true); setError(null); setAccuracy(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setError(t('confirmLoc.needPermission')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const acc = pos.coords.accuracy ?? null;
      setAccuracy(acc);
      if (acc != null && acc > MAX_ACCURACY_M) { setError(t('confirmLoc.tooWeak', { m: Math.round(acc) })); return; }
      const { error: e } = await supabase.rpc('confirm_branch_location', {
        p_team_id: branch.team_id,
        p_lat: pos.coords.latitude,
        p_lng: pos.coords.longitude,
        p_accuracy_m: acc,
      });
      if (e) { setError(e.message); return; }
      await Promise.all([load(), refresh()]);
    } catch (e: any) {
      setError(e?.message ?? t('confirmLoc.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => setDismissed(true)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 }}>
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="location" size={28} color={c.brand} />
            </View>
          </View>
          <Text style={{ fontSize: 19, fontWeight: '800', color: c.text, textAlign: 'center' }}>{t('confirmLoc.title')}</Text>
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.brand, textAlign: 'center', marginTop: 4 }}>{branch.name}</Text>
          <Text style={{ fontSize: 13, color: c.textMuted, textAlign: 'center', marginTop: 10, lineHeight: 19 }}>{t('confirmLoc.body')}</Text>

          {error ? (
            <View style={{ backgroundColor: c.roseSoft, borderRadius: 12, padding: 12, marginTop: 14 }}>
              <Text style={{ fontSize: 13, color: c.rose }}>{error}</Text>
            </View>
          ) : accuracy != null ? (
            <Text style={{ fontSize: 12, color: c.textMuted, textAlign: 'center', marginTop: 12 }}>{t('confirmLoc.accuracy', { m: Math.round(accuracy) })}</Text>
          ) : null}

          <View style={{ height: 18 }} />
          {busy ? <ActivityIndicator color={c.brand} /> : (
            <PrimaryButton title={t('confirmLoc.confirm')} onPress={confirm} />
          )}
          <Pressable onPress={() => setDismissed(true)} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ fontSize: 13, color: c.textMuted }}>{t('confirmLoc.later')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
