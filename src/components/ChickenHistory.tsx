import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { useAuth } from '@/hooks/useAuth';
import { useThemeColors } from '@/components/ui';
import type { ChickenMarination } from '@/types';

/** Chicken marination history, all roles (RLS-scoped): a day list → that day's
 * records with times, counts, who. */
export function ChickenHistory() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { records } = useChicken();
  const { teams } = useOrgData();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const [openDay, setOpenDay] = useState<string | null>(null);

  const teamName = (id: string) => teams.find((tm) => tm.id === id)?.name ?? '';
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' });

  const days = useMemo(() => {
    const map = new Map<string, ChickenMarination[]>();
    for (const x of records) {
      const key = new Date(x.marinatedAt).toDateString();
      (map.get(key) ?? map.set(key, []).get(key)!).push(x);
    }
    return [...map.entries()];
  }, [records]);

  const dayRecords = days.find(([k]) => k === openDay)?.[1] ?? [];

  if (records.length === 0) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, marginBottom: 10 }}>{t('chicken.historyTitle')}</Text>
      {days.slice(0, 30).map(([k, list]) => (
        <Pressable key={k} onPress={() => setOpenDay(k)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border, marginBottom: 8 }}>
          <Ionicons name="restaurant-outline" size={20} color={c.brand} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{new Date(k).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            <Text style={{ fontSize: 12, color: c.textMuted }}>{t('chicken.batchCount', { count: list.length })}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
        </Pressable>
      ))}

      <Modal visible={!!openDay} animationType="slide" transparent onRequestClose={() => setOpenDay(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{openDay ? new Date(openDay).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}</Text>
              <Pressable onPress={() => setOpenDay(null)} hitSlop={8}><Ionicons name="close" size={24} color={c.textMuted} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              {dayRecords.map((x) => (
                <View key={x.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name="arrow-down-circle" size={16} color={c.emerald} />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{time(x.marinatedAt)}</Text>
                    {x.countIn != null ? <Text style={{ fontSize: 13, color: c.textMuted }}>· {t('chicken.inN', { count: x.countIn })}</Text> : null}
                    {x.unloadedAt ? (
                      <>
                        <Ionicons name="arrow-up-circle" size={16} color={c.amber} />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{time(x.unloadedAt)}</Text>
                        {x.countOut != null ? <Text style={{ fontSize: 13, color: c.textMuted }}>· {t('chicken.outN', { count: x.countOut })}</Text> : null}
                      </>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 3 }}>
                    {isOwner ? `${teamName(x.teamId)} · ` : ''}{x.actorName ?? ''}{x.isAudit ? ` · ${t('chicken.byAuditor')}` : ''}
                  </Text>
                  {x.note ? <Text style={{ fontSize: 12, color: c.text, marginTop: 2 }}>“{x.note}”</Text> : null}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
