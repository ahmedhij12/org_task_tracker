import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { Ionicons } from '@expo/vector-icons';
import { Card, ErrorBanner, useThemeColors } from '@/components/ui';
import { ScheduleSheet } from '@/components/ScheduleSheet';

type Shift = 'AM' | 'PM' | 'OFF';
const SHIFTS: Shift[] = ['AM', 'PM', 'OFF'];

/** 'YYYY-MM-DD' for a date in local time (the branches all run on Baghdad time). */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The branch manager sets his supervisors' shifts — AM, PM or OFF — a day at
 * a time or a week ahead (spec section 3). This is what keeps the warnings
 * fair: a man who is off is never warned. Tapping the chosen shift again
 * clears it.
 */
export function ShiftsCard() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { members, teams } = useOrgData();
  // The admin schedules any branch — one without a manager has nobody else to do it.
  const myTeams = profile?.role === 'owner' ? teams : teams.filter((tm) => profile?.teamIds.includes(tm.id));
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const team = teamId ?? myTeams[0]?.id ?? null;

  const days = useMemo(() => {
    const out: Date[] = [];
    const d = new Date();
    for (let i = 0; i < 7; i++) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i));
    return out;
  }, []);
  const [day, setDay] = useState(iso(days[0]));
  const [shifts, setShifts] = useState<Record<string, Shift>>({}); // `${profileId}|${day}`
  const [error, setError] = useState<string | null>(null);

  const supervisors = members.filter((m) => m.role === 'employee' && !!team && m.teamIds.includes(team) && m.active);

  const load = useCallback(async () => {
    if (!team) return;
    const { data } = await supabase
      .from('shifts')
      .select('profile_id, day, shift')
      .eq('team_id', team)
      .gte('day', iso(days[0]))
      .lte('day', iso(days[days.length - 1]));
    const next: Record<string, Shift> = {};
    for (const r of data ?? []) next[`${r.profile_id}|${r.day}`] = r.shift as Shift;
    setShifts(next);
  }, [team, days]);
  useEffect(() => {
    load();
  }, [load]);

  const set = async (profileId: string, value: Shift) => {
    if (!team) return;
    const key = `${profileId}|${day}`;
    const next = shifts[key] === value ? null : value;
    // Show it at once; the database has the last word below.
    setShifts((s) => {
      const copy = { ...s };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
    setError(null);
    const { error: e } = await supabase.rpc('set_shift', { p_team_id: team, p_profile_id: profileId, p_day: day, p_shift: next });
    if (e) {
      setError(e.message ?? t('shifts.saveFailed'));
      load();
    }
  };

  const dayLabel = (d: Date, i: number) =>
    i === 0 ? t('shifts.today') : i === 1 ? t('shifts.tomorrow') : d.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' });
  const unset = supervisors.filter((m) => !shifts[`${m.id}|${day}`]).length;

  if (myTeams.length === 0) return null;

  const chip = (key: string, label: string, active: boolean, onPress: () => void, color = c.brand) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      style={{ minWidth: 52, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? color : c.bgSubtle, borderWidth: 1, borderColor: active ? color : c.border }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <Card style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase' }}>{t('shifts.title')}</Text>
        {supervisors.length > 0 ? (
          <Pressable
            testID="open-schedule"
            onPress={() => setScheduleOpen(true)}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.brand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <Ionicons name="calendar-outline" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('schedule.open')}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>{t('shifts.hint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {myTeams.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 10 }}>
          {myTeams.map((tm) => chip(tm.id, tm.name, team === tm.id, () => setTeamId(tm.id)))}
        </ScrollView>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
        {days.map((d, i) => chip(iso(d), dayLabel(d, i), day === iso(d), () => setDay(iso(d))))}
      </ScrollView>

      {supervisors.length === 0 ? (
        <Text style={{ fontSize: 13, color: c.textFaint }}>{t('shifts.noSupervisors')}</Text>
      ) : (
        supervisors.map((m) => {
          const current = shifts[`${m.id}|${day}`];
          return (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }} numberOfLines={1}>{m.name}</Text>
                {!current ? <Text style={{ fontSize: 11, color: c.amber }}>{t('shifts.notSet')}</Text> : null}
              </View>
              {SHIFTS.map((s) =>
                chip(s, t(`shifts.${s}`), current === s, () => set(m.id, s), s === 'OFF' ? c.textMuted : c.brand),
              )}
            </View>
          );
        })
      )}
      {supervisors.length > 0 && unset > 0 ? (
        <Text style={{ fontSize: 12, color: c.amber, marginTop: 8 }}>{t('shifts.unsetCount', { count: unset })}</Text>
      ) : null}
      {scheduleOpen && team ? (
        <ScheduleSheet
          visible
          teamId={team}
          supervisors={supervisors.map((m) => ({ id: m.id, name: m.name }))}
          onClose={() => setScheduleOpen(false)}
          onSaved={load}
        />
      ) : null}
    </Card>
  );
}
