import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChicken } from '@/hooks/useChicken';
import { useOrgData } from '@/hooks/useOrgData';
import { useAuth } from '@/hooks/useAuth';
import { PhotoViewer } from '@/components/PhotoViewer';
import { useThemeColors } from '@/components/ui';
import { BranchBackRow } from '@/components/BranchBackRow';
import type { ChickenMarination } from '@/types';
import { timeOf, dayKey, dateOf } from '@/lib/time';
import { marinationStatus, humanSpan } from '@/lib/marination';

/** Chicken marination history, all roles (RLS-scoped), built like the oil
 * section above it: with several branches in view it is one row per branch, and
 * tapping one opens THAT branch's marination days right here — the other
 * sections keep every branch. A day opens that day's records. */
export function ChickenHistory({ filter = 'all' }: { filter?: string } = {}) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { records } = useChicken();
  const { teams } = useOrgData();
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';
  const [openDay, setOpenDay] = useState<string | null>(null);
  // The branch opened inside this section; the screen's own filter wins.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [filter]);
  const [viewer, setViewer] = useState<string[] | null>(null);

  const teamName = (id: string) => teams.find((tm) => tm.id === id)?.name ?? '';
  // Show the time AT THE BRANCH, not the viewer's clock.
  const tzOf = (teamId: string) => teams.find((tm) => tm.id === teamId)?.timezone ?? 'Asia/Baghdad';
  const time = (iso: string, teamId: string) => timeOf(iso, i18n.language, tzOf(teamId));

  const inView = useMemo(
    () => (filter === 'all' ? records : records.filter((x) => x.teamId === filter)),
    [records, filter]
  );
  const scoped = useMemo(() => (picked ? inView.filter((x) => x.teamId === picked) : inView), [inView, picked]);
  const inViewBranchCount = useMemo(() => new Set(inView.map((x) => x.teamId)).size, [inView]);

  // One row per branch while more than one is in view, same as the fryers.
  const branches = useMemo(() => {
    const map = new Map<string, number>();
    for (const x of scoped) map.set(x.teamId, (map.get(x.teamId) ?? 0) + 1);
    return [...map.entries()].map(([teamId, count]) => ({ teamId, name: teamName(teamId), count }));
  }, [scoped, teams]);
  const collapsed = branches.length > 1;

  const days = useMemo(() => {
    const map = new Map<string, ChickenMarination[]>();
    for (const x of scoped) {
      const key = dayKey(x.marinatedAt, tzOf(x.teamId));
      (map.get(key) ?? map.set(key, []).get(key)!).push(x);
    }
    return [...map.entries()];
  }, [scoped]);

  const dayRecords = days.find(([k]) => k === openDay)?.[1] ?? [];

  if (scoped.length === 0) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, marginBottom: 10 }}>{t('chicken.historyTitle')}</Text>
      {picked && inViewBranchCount > 1 ? <BranchBackRow name={teamName(picked)} onBack={() => setPicked(null)} /> : null}
      {collapsed
        ? branches.map((b) => (
            <Pressable key={b.teamId} onPress={() => setPicked(b.teamId)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border, marginBottom: 8 }}>
              <Ionicons name="restaurant-outline" size={20} color={c.brand} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{b.name}</Text>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{t('chicken.batchCount', { count: b.count })}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
            </Pressable>
          ))
        : days.slice(0, 30).map(([k, list]) => (
        <Pressable key={k} onPress={() => setOpenDay(k)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border, marginBottom: 8 }}>
          <Ionicons name="restaurant-outline" size={20} color={c.brand} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{dateOf(k + 'T12:00:00Z', i18n.language)}</Text>
            <Text style={{ fontSize: 12, color: c.textMuted }}>{t('chicken.batchCount', { count: list.length })}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
        </Pressable>
      ))}

      <Modal visible={!!openDay && !collapsed} animationType="slide" transparent onRequestClose={() => setOpenDay(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{openDay ? dateOf(openDay + 'T12:00:00Z', i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}</Text>
              <Pressable onPress={() => setOpenDay(null)} hitSlop={8}><Ionicons name="close" size={24} color={c.textMuted} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }}>
              {dayRecords.map((x) => (
                <View key={x.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name="arrow-down-circle" size={16} color={c.emerald} />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{time(x.marinatedAt, x.teamId)}</Text>
                    {x.countIn != null ? <Text style={{ fontSize: 13, color: c.textMuted }}>· {t('chicken.inN', { count: x.countIn })}</Text> : null}
                    {x.unloadedAt ? (
                      <>
                        <Ionicons name="arrow-up-circle" size={16} color={c.amber} />
                        <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{time(x.unloadedAt, x.teamId)}</Text>
                        {x.countOut != null ? <Text style={{ fontSize: 13, color: c.textMuted }}>· {t('chicken.outN', { count: x.countOut })}</Text> : null}
                      </>
                    ) : null}
                  </View>
                  {x.unloadedAt ? (() => {
                    // Proof for the admin: was the vinegar out within the 3 hours?
                    const { state, ms } = marinationStatus(x);
                    const late = state === 'late';
                    const label = humanSpan(ms);
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <Ionicons name={late ? 'alert-circle' : 'checkmark-circle'} size={14} color={late ? c.rose : c.emerald} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: late ? c.rose : c.emerald }}>
                          {late ? t('chicken.removedLate', { time: label }) : t('chicken.removedOnTime')}
                        </Text>
                      </View>
                    );
                  })() : null}
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 3 }}>
                    {isOwner ? `${teamName(x.teamId)} · ` : ''}{x.actorName ?? ''}{x.isAudit ? ` · ${t('chicken.byAuditor')}` : ''}
                    {x.unloadedByName && x.unloadedByName !== x.actorName ? ` · ${t('chicken.emptiedBy', { name: x.unloadedByName })}` : ''}
                  </Text>
                  {/* The proof of the removal. It has always been uploaded and
                      stored; until now there was nowhere in the app to see it. */}
                  {x.unloadPhotoUrl ? (
                    <Pressable onPress={() => setViewer([x.unloadPhotoUrl!])} style={{ marginTop: 6 }}>
                      <Image source={{ uri: x.unloadPhotoUrl }} style={{ width: 72, height: 72, borderRadius: 10 }} />
                    </Pressable>
                  ) : x.unloadedAt ? (
                    <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 4 }}>{t('chicken.noRemovalPhoto')}</Text>
                  ) : null}
                  {x.note ? <Text style={{ fontSize: 12, color: c.text, marginTop: 2 }}>“{x.note}”</Text> : null}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {viewer ? <PhotoViewer urls={viewer} index={0} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}
