import { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { marinationStatus, humanSpan, type MarinationState } from '@/lib/marination';
import { timeOf, dayKey, todayKey } from '@/lib/time';
import { useThemeColors } from '@/components/ui';

/**
 * The admin/auditor's read-only view of the vinegar. He does not marinate —
 * he checks that every branch did, and whether the chicken came out on time.
 * Branches with nothing today are listed too: a missing record is the finding.
 */
export function ChickenMonitor() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { records } = useChicken();
  const { teams } = useOrgData();
  const [, setTick] = useState(0);

  // Keep "2h 10m left" honest without a reload.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const tzOf = (teamId: string) => teams.find((tm) => tm.id === teamId)?.timezone ?? 'Asia/Baghdad';

  const byBranch = useMemo(
    () =>
      teams.map((tm) => ({
        team: tm,
        // The branch's own day, not the admin's — a 1 AM batch belongs to the
        // shift that started it.
        rows: records
          .filter((r) => r.teamId === tm.id && dayKey(r.marinatedAt, tm.timezone ?? 'Asia/Baghdad') === todayKey(tm.timezone ?? 'Asia/Baghdad'))
          .slice(0, 6),
      })),
    [teams, records]
  );

  if (teams.length === 0) return null;

  const meta: Record<MarinationState, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
    marinating: { icon: 'time-outline', color: c.brand },
    overdue: { icon: 'alarm', color: c.rose },
    onTime: { icon: 'checkmark-circle', color: c.emerald },
    late: { icon: 'alert-circle', color: c.rose },
  };

  const label = (state: MarinationState, ms: number) =>
    state === 'marinating' ? t('chicken.dueIn', { time: humanSpan(ms) })
      : state === 'overdue' ? t('chicken.overdue', { time: humanSpan(ms) })
      : state === 'onTime' ? t('chicken.removedOnTime')
      : t('chicken.removedLate', { time: humanSpan(ms) });

  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Ionicons name="restaurant" size={18} color={c.brand} />
        <Text style={{ fontSize: 14, fontWeight: '800', color: c.text }}>{t('chicken.monitorTitle')}</Text>
      </View>

      {byBranch.map(({ team, rows }) => (
        <View key={team.id} style={{ padding: 12, borderRadius: 14, marginBottom: 8, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: c.text, marginBottom: rows.length ? 8 : 0 }}>{team.name}</Text>

          {rows.length === 0 ? (
            <Text style={{ fontSize: 12, color: c.textFaint }}>{t('chicken.noneToday')}</Text>
          ) : (
            rows.map((r) => {
              const { state, ms } = marinationStatus(r);
              const m = meta[state];
              return (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <Ionicons name={m.icon} size={15} color={m.color} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: m.color, flexShrink: 1 }}>{label(state, ms)}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted, flexShrink: 1 }} numberOfLines={1}>
                    {timeOf(r.marinatedAt, i18n.language, tzOf(r.teamId))}
                    {r.countIn != null ? ` · ${t('chicken.inN', { count: r.countIn })}` : ''}
                    {r.actorName ? ` · ${r.actorName}` : ''}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      ))}
    </View>
  );
}
