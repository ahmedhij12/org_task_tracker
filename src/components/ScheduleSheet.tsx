import { useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';

type Shift = 'AM' | 'PM' | 'OFF';
type Person = { id: string; name: string };

/** 'YYYY-MM-DD' for a date in local time (the branches all run on Baghdad time). */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const LENGTHS = [1, 3, 7, 14, 30];

/**
 * The manager's schedule, his way: pick one supervisor, a shift and the days —
 * "Oday, AM, the next 7 days" — and everyone else at the branch goes on the
 * other shift for those days (set_shift_range). OFF changes only that person.
 * Single days can still be changed one by one on the Shifts card.
 */
export function ScheduleSheet({
  visible,
  teamId,
  supervisors,
  onClose,
  onSaved,
}: {
  visible: boolean;
  teamId: string;
  supervisors: Person[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const starts = useMemo(() => {
    const d = new Date();
    return Array.from({ length: 8 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i));
  }, []);
  const [who, setWho] = useState<string | null>(supervisors.length === 1 ? supervisors[0].id : null);
  const [shift, setShift] = useState<Shift>('AM');
  const [start, setStart] = useState(0);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = starts[start];
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days - 1);
  const dateLabel = (d: Date) => d.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' });
  const startLabel = (d: Date, i: number) =>
    i === 0 ? t('shifts.today') : i === 1 ? t('shifts.tomorrow') : d.toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' });
  const other: Shift | null = shift === 'AM' ? 'PM' : shift === 'PM' ? 'AM' : null;
  const chosen = supervisors.find((s) => s.id === who);
  const others = supervisors.filter((s) => s.id !== who);

  const save = async () => {
    if (!who || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc('set_shift_range', {
        p_team_id: teamId,
        p_profile_id: who,
        p_from: iso(from),
        p_to: iso(to),
        p_shift: shift,
      });
      if (e) throw e;
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? t('shifts.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const chip = (key: string, label: string, active: boolean, onPress: () => void, color = c.brand) => (
    <Pressable
      key={key}
      testID={`schedule-${key}`}
      onPress={onPress}
      accessibilityRole="button"
      style={{ minWidth: 52, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: active ? color : c.bgSubtle, borderWidth: 1, borderColor: active ? color : c.border }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );
  const label = (text: string) => (
    <Text style={{ fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 }}>{text}</Text>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{t('schedule.title')}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t('common.cancel')}>
              <Ionicons name="close" size={24} color={c.textMuted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {error ? <View style={{ marginTop: 10 }}><ErrorBanner message={error} /></View> : null}

            {label(t('schedule.who'))}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {supervisors.map((s) => chip(`who-${s.name}`, s.name, who === s.id, () => setWho(s.id)))}
            </View>

            {label(t('schedule.shift'))}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['AM', 'PM', 'OFF'] as Shift[]).map((s) => chip(`shift-${s}`, t(`shifts.${s}`), shift === s, () => setShift(s), s === 'OFF' ? c.textMuted : c.brand))}
            </View>

            {label(t('schedule.from'))}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {starts.map((d, i) => chip(`from-${i}`, startLabel(d, i), start === i, () => setStart(i)))}
            </ScrollView>

            {label(t('schedule.howLong'))}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {LENGTHS.map((n) => chip(`days-${n}`, t('schedule.days', { count: n }), days === n, () => setDays(n)))}
            </View>

            <View testID="schedule-preview" style={{ marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: c.bgSubtle, gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>
                {days === 1 ? dateLabel(from) : t('schedule.range', { from: dateLabel(from), to: dateLabel(to) })}
              </Text>
              {chosen ? (
                <Text style={{ fontSize: 14, color: c.text }}>
                  <Text style={{ fontWeight: '800' }}>{chosen.name}</Text> · {t(`shifts.${shift}`)}
                </Text>
              ) : (
                <Text style={{ fontSize: 13, color: c.textFaint }}>{t('schedule.pickSomeone')}</Text>
              )}
              {chosen && other
                ? others.map((s) => (
                    <Text key={s.id} style={{ fontSize: 14, color: c.text }}>
                      <Text style={{ fontWeight: '800' }}>{s.name}</Text> · {t(`shifts.${other}`)}
                    </Text>
                  ))
                : null}
              {chosen && !other && others.length > 0 ? (
                <Text style={{ fontSize: 12, color: c.textMuted }}>{t('schedule.offOthersUnchanged')}</Text>
              ) : null}
            </View>

            <View style={{ marginTop: 16, marginBottom: 8 }}>
              <PrimaryButton title={t('schedule.save')} onPress={save} loading={busy} disabled={!who} />
            </View>
            <Text style={{ fontSize: 11, color: c.textMuted, textAlign: 'center', marginBottom: 8 }}>{t('schedule.reminderHint')}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
