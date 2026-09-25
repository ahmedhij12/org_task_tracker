import { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useThemeColors } from '@/components/ui';

type Row = {
  slot: 'AM' | 'PM' | 'DAY';
  due_at: string;
  grace_min: number;
  done_at: string | null;
  done_by: string | null;
  was_late: boolean | null;
  on_shift: string[];
};

/**
 * Today's checklist deadlines (control panel → Checklist deadlines): each one,
 * who is on it from the manager's schedule, and whether it is sent, due, or
 * late. Supervisors and managers see their branch; the admin every branch.
 * Nothing shows for a branch with no deadline set.
 */
export function ChecklistDeadlines() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const { teams, history } = useOrgData();
  const isAdmin = profile?.role === 'owner' || profile?.role === 'hygiene_auditor';
  const branches = isAdmin ? teams : teams.filter((tm) => profile?.teamIds.includes(tm.id));
  const branchKey = branches.map((b) => b.id).join(',');
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const next: Record<string, Row[]> = {};
    await Promise.all(
      branches.map(async (b) => {
        const { data } = await supabase.rpc('checklist_today', { p_team: b.id });
        if (Array.isArray(data) && data.length) next[b.id] = data as Row[];
      }),
    );
    setRows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchKey]);
  // Again whenever a checklist is saved anywhere (history changes), and every minute for the clock.
  useEffect(() => {
    load();
  }, [load, history[0]?.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const shown = branches.filter((b) => rows[b.id]);
  if (shown.length === 0) return null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <View testID="checklist-deadlines" style={{ marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>{t('deadlines.title')}</Text>
      {shown.map((b) => (
        <View key={b.id} style={{ marginTop: 4 }}>
          {shown.length > 1 || isAdmin ? <Text style={{ fontSize: 14, fontWeight: '800', color: c.text, marginTop: 6 }}>{b.name}</Text> : null}
          {rows[b.id].map((r) => {
            const due = new Date(r.due_at).getTime();
            const lateAt = due + r.grace_min * 60000;
            const state = r.done_at ? (r.was_late ? 'doneLate' : 'done') : now > lateAt ? 'late' : now > due - 60 * 60000 ? 'soon' : 'later';
            const color = state === 'done' ? c.emerald : state === 'doneLate' || state === 'soon' ? c.amber : state === 'late' ? c.rose : c.textMuted;
            const icon = state === 'done' || state === 'doneLate' ? 'checkmark-circle' : state === 'late' ? 'alert-circle' : 'time-outline';
            const who = r.on_shift.length ? r.on_shift.join(', ') : t('deadlines.anyone');
            return (
              <View key={r.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                <Ionicons name={icon as any} size={22} color={color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>
                    {t(`deadlines.slot${r.slot}`)} · {t('deadlines.by', { time: time(r.due_at) })}
                  </Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 1 }} numberOfLines={1}>
                    {r.done_at ? t('deadlines.sentBy', { name: r.done_by ?? '', time: time(r.done_at) }) : who}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: '800', color }}>
                  {state === 'done'
                    ? t('deadlines.onTime')
                    : state === 'doneLate'
                      ? t('deadlines.sentLate')
                      : state === 'late'
                        ? t('deadlines.late')
                        : state === 'soon'
                          ? t('deadlines.dueSoon')
                          : t('deadlines.notYet')}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
