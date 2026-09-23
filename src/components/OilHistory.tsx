import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOilTests } from '@/hooks/useOilTests';
import { useOrgData } from '@/hooks/useOrgData';
import { PhotoViewer } from '@/components/PhotoViewer';
import { useThemeColors } from '@/components/ui';
import type { OilGrade, OilTest } from '@/types';
import { timeOf, dayKey, dateOf } from '@/lib/time';

const GRADE_HEX: Record<OilGrade, string> = { good: '#10B981', watch: '#F59E0B', change: '#E8141A' };

/** History for oil tests, shared by all roles (RLS scopes the rows). With more
 * than one branch in view this stays ONE row per branch — tapping it narrows the
 * whole History screen to that branch, and only then do its fryers appear. A
 * group with twenty branches would otherwise open on a hundred fryer rows.
 * Inside a branch: tap a fryer → pick a day → that day's tests. */
export function OilHistory({ filter = 'all', onPickBranch }: { filter?: string; onPickBranch?: (teamId: string) => void } = {}) {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { tests, fryers } = useOilTests();
  const { teams } = useOrgData();

  const [openFryer, setOpenFryer] = useState<{ id: string; name: string; branch: string } | null>(null);
  const [viewer, setViewer] = useState<string[] | null>(null);

  const teamName = (id: string) => teams.find((tm) => tm.id === id)?.name ?? '';
  // Show the time AT THE BRANCH, not the viewer's clock.
  const tzOf = (teamId: string) => teams.find((tm) => tm.id === teamId)?.timezone ?? 'Asia/Baghdad';

  // Latest grade per active fryer, grouped by branch, plus the branch's own
  // roll-up: its worst fryer is what the admin needs to see from the outside.
  const branches = useMemo(() => {
    const latest = new Map<string, OilTest>();
    for (const x of tests) if (!latest.has(x.fryerId)) latest.set(x.fryerId, x); // tests are newest-first
    const groups = new Map<string, { id: string; name: string; grade: OilGrade | null; count: number }[]>();
    for (const f of fryers) {
      const last = latest.get(f.id);
      const count = tests.filter((x) => x.fryerId === f.id).length;
      (groups.get(f.teamId) ?? groups.set(f.teamId, []).get(f.teamId)!).push({
        id: f.id,
        name: f.name,
        grade: last?.grade ?? null,
        count,
      });
    }
    return [...groups.entries()].map(([teamId, rows]) => ({
      teamId,
      name: teamName(teamId),
      rows,
      tests: rows.reduce((n, r) => n + r.count, 0),
      needChange: rows.filter((r) => r.grade === 'change').length,
      worst: (rows.some((r) => r.grade === 'change')
        ? 'change'
        : rows.some((r) => r.grade === 'watch')
          ? 'watch'
          : rows.some((r) => r.grade === 'good')
            ? 'good'
            : null) as OilGrade | null,
    }));
  }, [tests, fryers, teams]);

  const scoped = filter === 'all' ? branches : branches.filter((b) => b.teamId === filter);
  // One row per branch only while several are in view; a single branch goes
  // straight to its fryers — there would be nothing to choose between.
  const collapsed = scoped.length > 1;

  const days = useMemo(() => {
    if (!openFryer) return [];
    const set = new Map<string, OilTest[]>();
    for (const x of tests) {
      if (x.fryerId !== openFryer.id) continue;
      const key = dayKey(x.testedAt, tzOf(x.teamId));
      (set.get(key) ?? set.set(key, []).get(key)!).push(x);
    }
    return [...set.entries()];
  }, [openFryer, tests]);

  const [day, setDay] = useState<string | null>(null);
  const dayTests = days.find(([k]) => k === day)?.[1] ?? days[0]?.[1] ?? [];

  if (fryers.length === 0 || scoped.length === 0) return null;

  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, marginBottom: 10 }}>{t('oil.historyTitle')}</Text>
      {collapsed
        ? scoped.map((b) => (
            <Pressable key={b.teamId} onPress={() => onPickBranch?.(b.teamId)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border, marginBottom: 8 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: b.worst ? GRADE_HEX[b.worst] : c.border }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{b.name}</Text>
                <Text style={{ fontSize: 12, color: b.needChange ? GRADE_HEX.change : c.textMuted }}>
                  {b.needChange
                    ? t('oil.needChange', { count: b.needChange })
                    : `${t('oil.fryersCount', { count: b.rows.length })} · ${t('oil.testsCount', { count: b.tests })}`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
            </Pressable>
          ))
        : scoped.map((b) =>
            b.rows.map((f) => (
              <Pressable key={f.id} onPress={() => { setOpenFryer({ id: f.id, name: f.name, branch: b.name }); setDay(null); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: c.bgSubtle, borderWidth: 1, borderColor: c.border, marginBottom: 8 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: f.grade ? GRADE_HEX[f.grade] : c.border }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{f.name}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>{t('oil.testsCount', { count: f.count })}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
              </Pressable>
            ))
          )}

      <Modal visible={!!openFryer} animationType="slide" transparent onRequestClose={() => setOpenFryer(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View>
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>{openFryer?.name}</Text>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{openFryer?.branch}</Text>
              </View>
              <Pressable onPress={() => setOpenFryer(null)} hitSlop={8}><Ionicons name="close" size={24} color={c.textMuted} /></Pressable>
            </View>

            {days.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                {days.map(([k]) => {
                  const active = (day ?? days[0][0]) === k;
                  return (
                    <Pressable key={k} onPress={() => setDay(k)}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: active ? c.brand : c.bgSubtle, borderWidth: 1, borderColor: active ? c.brand : c.border }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : c.text }}>
                        {dateOf(k + 'T12:00:00Z', i18n.language, { day: 'numeric', month: 'short' })}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <ScrollView style={{ maxHeight: 460 }}>
              {dayTests.map((x) => (
                <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
                  <Pressable onPress={() => setViewer([x.photoUrl])}>
                    <Image source={{ uri: x.photoUrl }} style={{ width: 54, height: 54, borderRadius: 10 }} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: GRADE_HEX[x.grade] }} />
                      <Text style={{ fontSize: 16, fontWeight: '800', color: GRADE_HEX[x.grade] }}>{x.tpm}%</Text>
                      {x.tempC != null ? <Text style={{ fontSize: 13, color: c.textMuted }}>· {x.tempC}°C</Text> : null}
                      {x.filtered ? <Ionicons name="funnel" size={13} color={c.textMuted} /> : null}
                    </View>
                    <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                      {timeOf(x.testedAt, i18n.language, tzOf(x.teamId))}
                      {x.actorName ? ` · ${x.actorName}` : ''}{x.isAudit ? ` · ${t('oil.byAuditor')}` : ''}
                    </Text>
                    {x.minutesLate != null ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
                        <Ionicons name="alert-circle" size={13} color={c.rose} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: c.rose }}>{t('oil.lateTag', { count: x.minutesLate })}</Text>
                      </View>
                    ) : null}
                    {x.lateReason ? <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>“{x.lateReason}”</Text> : null}
                    {x.note ? <Text style={{ fontSize: 12, color: c.text, marginTop: 2 }}>“{x.note}”</Text> : null}
                  </View>
                </View>
              ))}
              {dayTests.length === 0 ? <Text style={{ fontSize: 13, color: c.textFaint, paddingVertical: 20 }}>{t('oil.noTestsYet')}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {viewer ? <PhotoViewer urls={viewer} index={0} onClose={() => setViewer(null)} /> : null}
    </View>
  );
}
