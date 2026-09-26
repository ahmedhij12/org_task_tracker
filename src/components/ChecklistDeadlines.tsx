import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { seesAllBranches } from '@/lib/roles';
import { CompletionDetailSheet } from '@/components/CompletionDetailSheet';
import { useThemeColors } from '@/components/ui';
import type { TaskCompletion } from '@/types';

type Row = {
  slot: 'AM' | 'PM' | 'DAY';
  due_at: string;
  grace_min: number;
  done_at: string | null;
  done_by: string | null;
  /** null = sent before the deadline existed, so never judged. */
  was_late: boolean | null;
  on_shift: string[];
  completion_id: string | null;
  excused: boolean | null;
};
type State = 'done' | 'onTime' | 'doneLate' | 'excused' | 'late' | 'soon' | 'later';

/**
 * Today's checklist deadlines (control panel → Checklist deadlines): each one,
 * who is on it from the manager's schedule, and whether it is sent, due, or
 * late. Tap a sent one to open the checklist; a missing one offers "Remind
 * them now" to the admin, the auditor and the branch's manager. Supervisors and
 * managers see their branch; the admin and the auditor every branch. Nothing
 * shows for a branch with no deadline. The admin and the auditor follow late
 * checklists in the Checklists section instead (not on their dashboard).
 */
export function ChecklistDeadlines() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { teams, history } = useOrgData();
  const seesAll = seesAllBranches(profile);
  const canNudge = seesAll || profile?.role === 'team_admin';
  const branches = seesAll ? teams : teams.filter((tm) => profile?.teamIds.includes(tm.id));
  const branchKey = branches.map((b) => b.id).join(',');
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState<TaskCompletion | null>(null);
  const [nudging, setNudging] = useState<string | null>(null); // `${branch}|${slot}`
  const [nudged, setNudged] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const next: Record<string, Row[]> = {};
    await Promise.all(
      branches.map(async (b) => {
        const { data } = await supabase.rpc('checklist_today', { p_team: b.id });
        if (Array.isArray(data) && data.length) next[b.id] = data as Row[];
      }),
    );
    setRows(next);
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchKey]);
  // Fresh whenever the screen comes back into view (a deadline changed in the
  // control panel shows at once), whenever a checklist is saved anywhere
  // (history changes), and every minute for the clock.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => {
    load();
  }, [load, history[0]?.id]);
  useEffect(() => {
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  const stateOf = (r: Row): State => {
    if (r.done_at) return r.was_late == null ? 'done' : !r.was_late ? 'onTime' : r.excused ? 'excused' : 'doneLate';
    const due = new Date(r.due_at).getTime();
    if (now > due + r.grace_min * 60000) return 'late';
    return now > due - 60 * 60000 ? 'soon' : 'later';
  };

  const shown = branches.filter((b) => rows[b.id]);
  if (shown.length === 0) return null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true });

  const nudge = async (teamId: string, slot: Row['slot']) => {
    const key = `${teamId}|${slot}`;
    setNudging(key);
    const { data, error } = await supabase.rpc('nudge_checklist', { p_team: teamId, p_slot: slot });
    setNudged((m) => ({
      ...m,
      [key]: error ? error.message : Number(data) > 0 ? t('deadlines.reminded', { count: Number(data) }) : t('deadlines.nobodyReachable'),
    }));
    setNudging(null);
  };

  return (
    <View testID="checklist-deadlines" style={{ marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>{t('deadlines.title')}</Text>
      {shown.map((b) => (
        <View key={b.id} style={{ marginTop: 4 }}>
          {shown.length > 1 || seesAll ? <Text style={{ fontSize: 14, fontWeight: '800', color: c.text, marginTop: 6 }}>{b.name}</Text> : null}
          {rows[b.id].map((r) => {
            const state = stateOf(r);
            const color =
              state === 'done' || state === 'onTime' ? c.emerald
              : state === 'excused' ? c.textMuted
              : state === 'doneLate' || state === 'soon' ? c.amber
              : state === 'late' ? c.rose
              : c.textMuted;
            const icon = r.done_at ? 'checkmark-circle' : state === 'late' ? 'alert-circle' : 'time-outline';
            const who = r.on_shift.length ? r.on_shift.join(', ') : t('deadlines.anyone');
            const record = r.completion_id ? history.find((h) => h.id === r.completion_id) ?? null : null;
            const key = `${b.id}|${r.slot}`;
            const offerNudge = canNudge && !r.done_at && (state === 'late' || state === 'soon');
            return (
              <View key={r.slot} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                <Pressable
                  testID={`deadline-row-${b.name}-${r.slot}`}
                  onPress={record ? () => setOpen(record) : undefined}
                  disabled={!record}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <Ionicons name={icon as any} size={22} color={color} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>
                      {t(`deadlines.slot${r.slot}`)} · {t('deadlines.by', { time: time(r.due_at) })}
                    </Text>
                    <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 1 }} numberOfLines={1}>
                      {r.done_at ? t('deadlines.sentBy', { name: r.done_by ?? '', time: time(r.done_at) }) : who}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '800', color }}>{t(`deadlines.state_${state}`)}</Text>
                  {record ? <Ionicons name="chevron-forward" size={16} color={c.textFaint} /> : null}
                </Pressable>
                {offerNudge ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginStart: 32 }}>
                    <Pressable
                      testID={`deadline-nudge-${b.name}-${r.slot}`}
                      onPress={() => nudge(b.id, r.slot)}
                      disabled={nudging === key}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.brand, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, opacity: nudging === key ? 0.6 : 1 }}
                    >
                      {nudging === key ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="notifications-outline" size={14} color="#fff" />}
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{t('deadlines.remindNow')}</Text>
                    </Pressable>
                    {nudged[key] ? <Text style={{ flex: 1, fontSize: 11, color: c.textMuted }}>{nudged[key]}</Text> : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      {open ? (
        <CompletionDetailSheet
          completion={open}
          onClose={() => {
            setOpen(null);
            load(); // an excuse just given clears the row now, not at the next minute
          }}
        />
      ) : null}
    </View>
  );
}
