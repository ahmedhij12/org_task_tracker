import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useOrgData } from '@/hooks/useOrgData';
import { Card, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';

type Reach = { phones: number; state: string | null; detail: string | null; standalone: boolean | null };

/**
 * "Did the notification reach them?" — a test sent to one branch, or to the
 * people ticked below. Each person shows whether their phone can be reached,
 * and if not, why — from what the phone itself reported (push_status), so
 * "she turned it on" can be checked instead of guessed.
 */
export function PushTestCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { teams, allMembers } = useOrgData();
  const [picked, setBranch] = useState<string | null>(null);
  // The branches load after the first render; until one is tapped, the first.
  const branch = picked ?? teams[0]?.id ?? null;
  const [people, setPeople] = useState<string[]>([]);
  const [byPeople, setByPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reach, setReach] = useState<Record<string, Reach>>({});

  const loadReach = useCallback(async () => {
    const { data } = await supabase.rpc('push_overview');
    const next: Record<string, Reach> = {};
    for (const r of (data as any[]) ?? []) next[r.profile_id] = { phones: r.phones, state: r.state, detail: r.detail, standalone: r.standalone };
    setReach(next);
  }, []);
  useEffect(() => {
    loadReach();
  }, [loadReach]);

  const branchPeople = allMembers.filter((m) => !m.deletedAt && m.active);
  // One line per person: reachable, or the reason they are not.
  const reachLine = (id: string): { text: string; color: string } => {
    const r = reach[id];
    if (r?.phones) return { text: t('control.reachOn'), color: c.emerald };
    if (!r?.state) return { text: t('control.reachNoReport'), color: c.textFaint };
    if (r.state === 'needs-install') return { text: t('control.reachInstall'), color: c.amber };
    if (r.state === 'denied') return { text: t('control.reachDenied'), color: c.rose };
    if (r.state === 'default') return { text: t('control.reachNotAsked'), color: c.amber };
    if (r.state === 'unsupported') return { text: t('control.reachUnsupported'), color: c.textMuted };
    if (r.state === 'error') return { text: t('control.reachError', { detail: r.detail ?? '' }), color: c.rose };
    return { text: t('control.reachNotRegistered'), color: c.amber };
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: e } = await supabase.rpc('send_test_push_to', {
        p_team_id: byPeople ? null : branch,
        p_profile_ids: byPeople ? people : null,
      });
      if (e) throw e;
      setResult(Number(data) > 0 ? t('control.pushSent', { count: Number(data) }) : t('control.pushNobody'));
      loadReach();
    } catch (err: any) {
      setError(err?.message ?? t('control.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? c.brand : c.bgSubtle, borderWidth: 1, borderColor: active ? c.brand : c.border }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>{t('control.pushTitle')}</Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>{t('control.pushHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {chip('b', t('control.pushToBranch'), !byPeople, () => setByPeople(false))}
        {chip('p', t('control.pushToPeople'), byPeople, () => setByPeople(true))}
      </View>
      {!byPeople ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {teams.map((tm) => chip(tm.id, tm.name, branch === tm.id, () => setBranch(tm.id)))}
        </ScrollView>
      ) : (
        <View>
          {branchPeople.map((m) => {
            const on = people.includes(m.id);
            return (
              <Pressable key={m.id} onPress={() => setPeople((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.brand : c.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: c.text }}>{m.name}</Text>
                  <Text testID={`reach-${m.name}`} style={{ fontSize: 11, color: reachLine(m.id).color, marginTop: 1 }}>{reachLine(m.id).text}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {result ? <Text style={{ fontSize: 13, color: c.brand, marginTop: 10 }}>{result}</Text> : null}
      <View style={{ marginTop: 12 }}>
        <PrimaryButton title={t('control.pushSend')} onPress={send} loading={busy} disabled={byPeople ? people.length === 0 : !branch} />
      </View>
    </Card>
  );
}
