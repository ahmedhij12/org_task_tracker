import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { checkInFor } from '@/lib/checkIn';
import { Card, ErrorBanner, useThemeColors } from '@/components/ui';
import { MenuButton } from '@/components/SideMenu';
import { groupActivity, changedFields, type ActivityGroup, type ActivityRow, type Geo, type Summary } from '@/lib/describeActivity';

const PAGE = 300;

/**
 * The super admin's record of what the admins and the hygiene auditor do.
 * The database refuses these rows to anyone else (RLS); this screen also
 * sends anyone else back to Settings, and no one else has a way in.
 */
export default function ActivityScreen() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { teams } = useOrgData();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [changesOnly, setChangesOnly] = useState(false);
  const [open, setOpen] = useState<ActivityGroup | null>(null);

  const load = useCallback(
    async (older: boolean) => {
      setLoading(true);
      setError(null);
      try {
        let q = supabase.from('admin_activity').select('*').order('id', { ascending: false }).limit(PAGE);
        if (older && rows.length) q = q.lt('id', rows[rows.length - 1].id);
        const { data, error: e } = await q;
        if (e) throw e;
        const got = (data ?? []) as ActivityRow[];
        setRows((prev) => (older ? [...prev, ...got] : got));
        setDone(got.length < PAGE);
      } catch (e: any) {
        setError(e?.message ?? t('activity.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [rows],
  );

  useEffect(() => {
    if (profile?.isSuperAdmin) load(false);
  }, [profile?.isSuperAdmin]);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.actor_id) m.set(r.actor_id, r.actor_name ?? '');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const groups = useMemo(() => {
    const shown = rows.filter((r) => (!person || r.actor_id === person) && (!changesOnly || r.kind === 'change' || r.kind === 'password'));
    return groupActivity(shown);
  }, [rows, person, changesOnly]);

  const days = useMemo(() => {
    const out: { day: string; items: ActivityGroup[] }[] = [];
    for (const g of groups) {
      const day = new Date(g.at).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' });
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(g);
    }
    return out;
  }, [groups, i18n.language]);

  if (!profile) return null;
  if (!profile.isSuperAdmin) return <Redirect href="/(main)/settings" />;

  const say = (s: Summary) =>
    t(s.key, { ...s.params, screen: s.params.screenKey ? t(String(s.params.screenKey)) : undefined });
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true });
  // Where the phone was: the street, or why there is none.
  const placeOf = (geo: Geo | null): string | null => {
    if (!geo) return null;
    if (geo.s !== 'ok' || geo.lat == null || geo.lng == null) return t(`activity.loc_${geo.s}`);
    return geo.place ?? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`;
  };
  // The closest branch with a pin: "at Baghdad branch" inside its circle, else how far.
  const nearestOf = (geo: Geo | null): string | null => {
    if (!geo || geo.s !== 'ok' || geo.lat == null || geo.lng == null) return null;
    let best: { name: string; meters: number; inside: boolean } | null = null;
    for (const team of teams) {
      const ci = checkInFor({ lat: geo.lat, lng: geo.lng, accuracyM: geo.acc ?? null }, team);
      if (ci && (!best || ci.meters < best.meters)) best = { name: team.name, meters: ci.meters, inside: ci.status === 'in' };
    }
    if (!best) return null;
    if (best.inside) return t('activity.atBranch', { name: best.name });
    const distance = best.meters < 1000 ? `${best.meters} m` : `${(best.meters / 1000).toFixed(1)} km`;
    return t('activity.fromBranch', { distance, name: best.name });
  };
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? c.brand : c.bgSubtle, borderWidth: 1, borderColor: active ? c.brand : c.border }}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading && rows.length > 0} onRefresh={() => load(false)} tintColor={c.brand} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('activity.title')}</Text>
        </View>
        <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 14 }}>{t('activity.subtitle')}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 8 }}>
          {chip(t('activity.all'), person === null, () => setPerson(null))}
          {people.map(([id, name]) => chip(name, person === id, () => setPerson(id)))}
        </ScrollView>
        <View style={{ flexDirection: 'row', marginBottom: 16 }}>{chip(t('activity.changesOnly'), changesOnly, () => setChangesOnly((v) => !v))}</View>

        {error ? <ErrorBanner message={error} /> : null}
        {!loading && groups.length === 0 && !error ? <Text style={{ fontSize: 13, color: c.textFaint }}>{t('activity.empty')}</Text> : null}

        {days.map(({ day, items }) => (
          <View key={day} style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>{day}</Text>
            {items.map((g) => (
              <Pressable key={g.key} onPress={() => setOpen(g)} accessibilityRole="button" testID="activity-row">
                <Card style={{ marginBottom: 8, borderColor: g.serious ? c.rose : c.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <Ionicons
                      name={g.serious ? 'warning' : g.rows[0].kind === 'change' || g.rows[0].kind === 'password' ? 'create' : 'eye-outline'}
                      size={18}
                      color={g.serious ? c.rose : g.rows[0].kind === 'change' ? c.brand : c.textFaint}
                      style={{ marginTop: 2 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, color: c.text }}>
                        <Text style={{ fontWeight: '800' }}>{g.actorName}</Text> {say(g.summary)}
                      </Text>
                      {g.more > 0 ? <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{t('activity.more', { count: g.more })}</Text> : null}
                      <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 3 }}>
                        {[time(g.at), g.device, placeOf(g.geo) ?? g.ip].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        ))}

        {loading ? <ActivityIndicator color={c.brand} style={{ marginTop: 12 }} /> : null}
        {!loading && !done && rows.length > 0 ? (
          <Pressable onPress={() => load(true)} style={{ alignItems: 'center', paddingVertical: 14 }}>
            <Text style={{ color: c.brand, fontWeight: '700' }}>{t('activity.loadMore')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={!!open} animationType="slide" transparent onRequestClose={() => setOpen(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '88%' }}>
            {open ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                  <Text style={{ flex: 1, fontSize: 16, color: c.text }}>
                    <Text style={{ fontWeight: '800' }}>{open.actorName}</Text> {say(open.summary)}
                  </Text>
                  <Pressable onPress={() => setOpen(null)} hitSlop={8}>
                    <Ionicons name="close" size={24} color={c.textMuted} />
                  </Pressable>
                </View>
                <Fact label={t('activity.when')} value={new Date(open.at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'medium' })} />
                <Fact label={t('activity.device')} value={open.device ?? '—'} />
                <Fact
                  label={t('activity.location')}
                  value={
                    (placeOf(open.geo) ?? '—') +
                    (open.geo?.s === 'ok' && open.geo.acc != null ? ` · ±${open.geo.acc} m` : '')
                  }
                />
                {nearestOf(open.geo) ? <Fact label={t('activity.nearest')} value={nearestOf(open.geo)!} /> : null}
                <Fact label={t('activity.ip')} value={open.ip ?? '—'} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 14, marginBottom: 6 }}>{t('activity.details')}</Text>
                <ScrollView style={{ maxHeight: 420 }}>
                  {open.rows.map((r) => (
                    <RowDetail key={r.id} row={r} />
                  ))}
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const c = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingVertical: 3 }}>
      <Text style={{ width: 90, fontSize: 13, color: c.textMuted }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 13, color: c.text }} selectable>{value}</Text>
    </View>
  );
}

const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** One database row of the action: what changed, or — on an add or delete — the row as it was. */
function RowDetail({ row }: { row: ActivityRow }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  if (row.kind !== 'change') {
    return <Text style={{ fontSize: 12, color: c.textFaint, paddingVertical: 6 }}>{row.detail ? show(row.detail) : t('activity.noDetail')}</Text>;
  }
  const table = String(row.table_name ?? '').replace(/_/g, ' ');
  const heading = row.op === 'insert' ? t('activity.inserted', { table }) : row.op === 'delete' ? t('activity.deleted', { table }) : t('activity.updated', { table });
  const diff = changedFields(row);
  // An add or a delete shows the whole row — for a delete, this is the copy to put back from.
  const whole = row.op === 'update' ? [] : Object.entries((row.op === 'delete' ? row.before : row.after) ?? {}).filter(([, v]) => v != null && v !== '');
  return (
    <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: row.op === 'delete' ? c.rose : c.text, marginBottom: 4 }}>{heading}</Text>
      {diff.map((d) => (
        <Text key={d.field} style={{ fontSize: 12, color: c.text }} selectable>
          <Text style={{ color: c.textMuted }}>{d.field}: </Text>
          {show(d.from)} → {show(d.to)}
        </Text>
      ))}
      {whole.map(([k, v]) => (
        <Text key={k} style={{ fontSize: 12, color: c.text }} numberOfLines={3} selectable>
          <Text style={{ color: c.textMuted }}>{k}: </Text>
          {show(v)}
        </Text>
      ))}
    </View>
  );
}
