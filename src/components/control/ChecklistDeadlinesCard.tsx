import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useOrgData } from '@/hooks/useOrgData';
import { TimeField } from '@/components/TimeField';
import { Card, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { parseSetting } from '@/components/control/SettingRow';
import { clockLabel } from '@/lib/time';

type Mode = 'shift' | 'day' | 'off';
type Rule = { mode: 'shift' | 'day'; am: string | null; pm: string | null; day: string | null; grace: number };

const hhmm = (v: unknown) => (v ? String(v).slice(0, 5) : null);
const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * The checklist deadlines, per branch (his call: "I will control it"). Per
 * shift = an AM and a PM deadline, sent by whoever the manager put on that
 * shift; per day = one deadline. Plus the grace before it counts as late.
 * A branch with no deadline behaves as before.
 */
export function ChecklistDeadlinesCard() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { teams } = useOrgData();
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [editing, setEditing] = useState<string | null>(null); // a branch id
  const [mode, setMode] = useState<Mode>('shift');
  const [am, setAm] = useState('');
  const [pm, setPm] = useState('');
  const [day, setDay] = useState('');
  const [grace, setGrace] = useState('30');
  const [allBranches, setAllBranches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('checklist_rules').select('team_id, mode, am_due, pm_due, day_due, grace_min');
    const next: Record<string, Rule> = {};
    for (const r of data ?? []) next[r.team_id] = { mode: r.mode, am: hhmm(r.am_due), pm: hhmm(r.pm_due), day: hhmm(r.day_due), grace: r.grace_min };
    setRules(next);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const open = (teamId: string) => {
    const r = rules[teamId];
    setEditing(teamId);
    setMode(r?.mode ?? 'shift');
    setAm(r?.am ?? '');
    setPm(r?.pm ?? '');
    setDay(r?.day ?? '');
    setGrace(String(r?.grace ?? 30));
    setAllBranches(false);
    setError(null);
    setNotice(null);
  };

  const g = parseSetting(grace, 0, 240);
  const canSave =
    mode === 'off' || (g != null && (mode === 'shift' ? validTime(am) && validTime(pm) : validTime(day)));

  const save = async () => {
    if (!editing || !canSave || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc('set_checklist_rule', {
        p_team_id: allBranches ? null : editing,
        p_mode: mode === 'off' ? null : mode,
        p_am_due: mode === 'shift' ? am : null,
        p_pm_due: mode === 'shift' ? pm : null,
        p_day_due: mode === 'day' ? day : null,
        p_grace_min: mode === 'off' ? null : g,
      });
      if (e) throw e;
      await load();
      const name = allBranches ? t('control.allBranches') : teams.find((b) => b.id === editing)?.name ?? '';
      setNotice(mode === 'off' ? t('control.deadlineRemoved', { name }) : t('control.deadlineSaved', { name }));
      setEditing(null);
    } catch (e: any) {
      setError(e?.message ?? t('control.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const summary = (r: Rule | undefined) => {
    if (!r) return t('control.deadlineNone');
    const times =
      r.mode === 'shift'
        ? t('control.deadlineShiftSummary', { am: clockLabel(r.am!, i18n.language), pm: clockLabel(r.pm!, i18n.language) })
        : t('control.deadlineDaySummary', { time: clockLabel(r.day!, i18n.language) });
    return `${times} · ${t('control.deadlineGraceSummary', { min: r.grace })}`;
  };

  const modeChip = (m: Mode, label: string) => (
    <Pressable
      key={m}
      testID={`deadline-mode-${m}`}
      onPress={() => setMode(m)}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: mode === m ? (m === 'off' ? c.textMuted : c.brand) : c.bgSubtle, borderWidth: 1, borderColor: mode === m ? (m === 'off' ? c.textMuted : c.brand) : c.border }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: mode === m ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>{t('control.deadlineTitle')}</Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 6 }}>{t('control.deadlineHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}

      {teams.map((tm) =>
        editing === tm.id ? (
          <View key={tm.id} testID={`deadline-edit-${tm.name}`} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '800', color: c.text }}>{tm.name}</Text>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color={c.textMuted} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {modeChip('shift', t('control.deadlinePerShift'))}
              {modeChip('day', t('control.deadlinePerDay'))}
              {modeChip('off', t('control.deadlineOff'))}
            </View>
            {mode === 'shift' ? (
              <>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{t('control.deadlinePerShiftHint')}</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TimeField label={t('control.deadlineAm')} value={am} onChange={setAm} />
                  <TimeField label={t('control.deadlinePm')} value={pm} onChange={setPm} />
                </View>
              </>
            ) : mode === 'day' ? (
              <>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{t('control.deadlinePerDayHint')}</Text>
                <View style={{ flexDirection: 'row' }}>
                  <TimeField label={t('control.deadlineDay')} value={day} onChange={setDay} />
                </View>
              </>
            ) : (
              <Text style={{ fontSize: 12, color: c.textMuted }}>{t('control.deadlineOffHint')}</Text>
            )}
            {mode !== 'off' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{t('control.deadlineGrace')}</Text>
                  <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 2 }}>{t('control.deadlineGraceHint')}</Text>
                </View>
                <TextInput
                  testID="deadline-grace"
                  value={grace}
                  onChangeText={setGrace}
                  keyboardType="number-pad"
                  maxLength={3}
                  style={{ width: 70, borderWidth: 1, borderColor: g == null ? c.rose : c.border, borderRadius: 10, padding: 8, fontSize: 15, color: c.text, textAlign: 'center' }}
                />
                <Text style={{ fontSize: 12, color: c.textMuted }}>{t('control.unitMin')}</Text>
              </View>
            ) : null}
            {teams.length > 1 ? (
              <Pressable onPress={() => setAllBranches((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name={allBranches ? 'checkbox' : 'square-outline'} size={20} color={allBranches ? c.brand : c.textMuted} />
                <Text style={{ fontSize: 13, color: c.text }}>{t('control.deadlineApplyAll')}</Text>
              </Pressable>
            ) : null}
            <PrimaryButton title={t('control.save')} onPress={save} loading={busy} disabled={!canSave} />
          </View>
        ) : (
          <Pressable
            key={tm.id}
            testID={`deadline-${tm.name}`}
            onPress={() => open(tm.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}
          >
            <Ionicons name="alarm-outline" size={18} color={rules[tm.id] ? c.brand : c.textFaint} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{tm.name}</Text>
              <Text style={{ fontSize: 12, color: rules[tm.id] ? c.textMuted : c.textFaint, marginTop: 2 }}>{summary(rules[tm.id])}</Text>
            </View>
            <Ionicons name="create-outline" size={20} color={c.textMuted} />
          </Pressable>
        ),
      )}
      {notice ? <Text style={{ fontSize: 12, color: c.brand, marginTop: 8 }}>{notice}</Text> : null}
    </Card>
  );
}
