import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MenuButton } from '@/components/SideMenu';
import { useOrgData } from '@/hooks/useOrgData';
import { useAuth } from '@/hooks/useAuth';
import { auditsAndVerifies, can } from '@/lib/roles';
import { useSupervisorChecklists } from '@/hooks/useSupervisorChecklists';
import { CompletionDetailSheet } from '@/components/CompletionDetailSheet';
import { CreateChecklistTemplateSheet } from '@/components/CreateChecklistTemplateSheet';
import { useChecklists } from '@/hooks/useChecklists';
import { checkInFor } from '@/lib/checkIn';
import { Card, useThemeColors } from '@/components/ui';
import type { TaskCompletion } from '@/types';

type Missing = { slot: 'AM' | 'PM' | 'DAY'; dueAt: string; who: string[] };

/**
 * Per branch: today's checklists past their deadline + grace and still not
 * sent (checklist_today). Only shown, never chased from here — the reminders
 * go out on their own, and he types the reason when he sends it.
 */
function useLateNotSent(teamIds: string[]): Record<string, Missing[]> {
  const key = teamIds.join(',');
  const [late, setLate] = useState<Record<string, Missing[]>>({});
  const load = useCallback(async () => {
    const now = Date.now();
    const next: Record<string, Missing[]> = {};
    await Promise.all(
      teamIds.map(async (id) => {
        const { data } = await supabase.rpc('checklist_today', { p_team: id });
        const rows = (Array.isArray(data) ? data : [])
          .filter((r: any) => !r.done_at && now > new Date(r.due_at).getTime() + (r.grace_min ?? 0) * 60000)
          .map((r: any) => ({ slot: r.slot, dueAt: r.due_at, who: r.on_shift ?? [] }));
        if (rows.length) next[id] = rows;
      }),
    );
    setLate(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => {
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);
  return late;
}

function dayLabel(iso: string, locale: string, t: (k: string) => string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('checklists.today');
  if (d.toDateString() === yesterday.toDateString()) return t('checklists.yesterday');
  return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function ChecklistsScreen() {
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const { teams, allMembers, loading, refresh } = useOrgData();
  const { profile } = useAuth();
  // Verifies and edits the templates: the admin and the hygiene auditor.
  const isOwner = auditsAndVerifies(profile);
  const submissions = useSupervisorChecklists();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<TaskCompletion | null>(null);
  // Editing a template used to live behind the "+" screen, which is gone;
  // the checklists themselves are the natural home for their questions.
  const { templates } = useChecklists();
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const kindOf = (tpl: (typeof templates)[number]) =>
    tpl.assignToRole === 'employee'
      ? t('checklists.kindSupervisor')
      : tpl.assignToRole === 'team_admin'
        ? t('checklists.kindManager')
        : tpl.name.endsWith(' — Audit')
          ? t('checklists.kindAudit')
          : t('checklists.kindOther');

  const branches = useMemo(() => {
    // A branch manager sees only their own branch(es), and their own
    // checklist isn't theirs to verify, so it doesn't count as waiting.
    return teams
      .filter((team) => isOwner || profile?.teamIds.includes(team.id))
      .map((team) => {
        const rows = submissions
          .filter((s) => s.teamId === team.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        // Only the people who verify see a waiting count; the manager no longer verifies.
        return { team, rows, unverified: isOwner ? rows.filter((r) => !r.reviewedBy).length : 0 };
      })
      .sort((a, b) => b.unverified - a.unverified || a.team.name.localeCompare(b.team.name));
  }, [teams, submissions, isOwner, profile?.id, profile?.teamIds]);

  const lateNotSent = useLateNotSent(branches.map((b) => b.team.id));
  // Only the people who decide late checklists are told to decide.
  const canDecide = can(profile, 'excuse_late');
  const nameOf = (id: string) => allMembers.find((m) => m.id === id)?.name ?? t('history.someone');
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.brand} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('checklists.title')}</Text>
        </View>
        <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 18 }}>{t(isOwner ? 'checklists.subtitle' : 'checklists.subtitleManager')}</Text>

        {branches.map(({ team, rows, unverified }) => {
          const open = expanded === team.id;
          let lastDay = '';
          return (
            <Card key={team.id} style={{ marginBottom: 10 }}>
              <Pressable
                onPress={() => setExpanded(open ? null : team.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Ionicons name="business-outline" size={20} color={c.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{team.name}</Text>
                  {lateNotSent[team.id]?.map((m) => (
                    <Text key={m.slot} testID={`late-missing-${team.name}-${m.slot}`} style={{ fontSize: 12, fontWeight: '700', color: c.rose, marginTop: 2 }}>
                      {t('checklists.lateNotSent', { slot: t(`deadlines.slot${m.slot}`), time: time(m.dueAt), who: m.who.length ? m.who.join(', ') : t('deadlines.anyone') })}
                    </Text>
                  ))}
                </View>
                {unverified > 0 ? (
                  <View style={{ minWidth: 24, height: 24, borderRadius: 12, backgroundColor: c.rose, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{unverified}</Text>
                  </View>
                ) : rows.length > 0 ? (
                  <Ionicons name="checkmark-done" size={18} color={c.emerald} />
                ) : null}
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
              </Pressable>

              {open ? (
                <View style={{ marginTop: 12 }}>
                  {rows.length === 0 ? (
                    <Text style={{ fontSize: 13, color: c.textFaint }}>{t('checklists.none')}</Text>
                  ) : (
                    rows.map((r) => {
                      const day = dayLabel(r.createdAt, i18n.language, t);
                      const showDay = day !== lastDay;
                      lastDay = day;
                      const verified = !!r.reviewedBy;
                      const late = r.wasLate && !!r.checklistSlot;
                      // A late one waits on the auditor's decision; once decided, the badge says which.
                      const badge =
                        r.lateOutcome === 'penalty'
                          ? { text: t('checklists.outcomePenalty'), fg: c.rose, bg: c.roseSoft }
                          : r.lateOutcome === 'warning'
                            ? { text: t('checklists.outcomeWarning'), fg: c.amber, bg: c.amberSoft }
                            : verified
                              ? { text: `✓ ${t('checklists.verified')}`, fg: c.emerald, bg: c.emeraldSoft }
                              : late && !r.lateExcusedAt && canDecide
                                ? { text: t('checklists.lateDecide'), fg: c.rose, bg: c.roseSoft }
                                : { text: t('checklists.new'), fg: c.rose, bg: c.roseSoft };
                      // A daily checklist is measured against its own branch.
                      const where = checkInFor({ lat: r.signedLat, lng: r.signedLng, accuracyM: r.signedAccuracyM }, team);
                      return (
                        <View key={r.id}>
                          {showDay ? (
                            <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 6, marginBottom: 6 }}>
                              {day}
                            </Text>
                          ) : null}
                          <Pressable
                            onPress={() => setSelected(r)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 10,
                              padding: 10,
                              borderRadius: 12,
                              backgroundColor: c.bgSubtle,
                              marginBottom: 8,
                              borderWidth: 1,
                              borderColor: verified ? c.border : c.rose,
                            }}
                          >
                            {r.selfieUrl ? (
                              <Image source={{ uri: r.selfieUrl }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                            ) : (
                              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="person" size={18} color={c.textMuted} />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{nameOf(r.actorId)}</Text>
                                {allMembers.find((m) => m.id === r.actorId)?.role === 'team_admin' ? (
                                  <View style={{ backgroundColor: c.brandSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
                                    <Text style={{ fontSize: 9, fontWeight: '800', color: c.brand }}>{t('checklists.manager')}</Text>
                                  </View>
                                ) : null}
                                {late ? (
                                  <View testID={`late-tag-${r.id}`} style={{ backgroundColor: c.roseSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
                                    <Text style={{ fontSize: 9, fontWeight: '800', color: c.rose }}>{t('checklists.late')}</Text>
                                  </View>
                                ) : null}
                              </View>
                              <Text style={{ fontSize: 12, color: c.textMuted }}>
                                {time(r.createdAt)}
                                {r.noCount != null ? ` · ${t('checklists.yesNo', { yes: r.yesCount ?? 0, no: r.noCount })}` : ''}
                                {r.signedAddress ? ` · ${r.signedAddress}` : ''}
                              </Text>
                              {where && where.status !== 'in' ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }} testID="check-in-badge">
                                  <Ionicons name="location" size={12} color={where.status === 'out' ? c.rose : c.amber} />
                                  <Text style={{ fontSize: 11, fontWeight: '800', color: where.status === 'out' ? c.rose : c.amber }}>
                                    {where.status === 'out' ? t('checklists.notInKitchen') : t('checklists.locationUnclear')} · {where.meters} m
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <View testID={`badge-${r.id}`} style={{ backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: badge.fg }}>{badge.text}</Text>
                            </View>
                          </Pressable>
                        </View>
                      );
                    })
                  )}
                </View>
              ) : null}
            </Card>
          );
        })}

        {isOwner ? (
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase' }}>{t('checklists.templatesTitle')}</Text>
            <Text style={{ fontSize: 12, color: c.textFaint, marginTop: 2, marginBottom: 10 }}>{t('checklists.templatesHint')}</Text>
            {templates
              .filter((tpl) => !tpl.archived)
              .map((tpl) => (
                <Pressable key={tpl.id} onPress={() => setEditingTemplateId(tpl.id)} accessibilityRole="button">
                  <Card style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="document-text-outline" size={20} color={c.brand} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{tpl.name}</Text>
                        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{kindOf(tpl)}</Text>
                      </View>
                      <Ionicons name="create-outline" size={20} color={c.textMuted} />
                    </View>
                  </Card>
                </Pressable>
              ))}
          </View>
        ) : null}
      </ScrollView>

      <CreateChecklistTemplateSheet
        visible={!!editingTemplateId}
        editingTemplateId={editingTemplateId ?? undefined}
        onClose={() => setEditingTemplateId(null)}
      />

      {selected ? (
        <CompletionDetailSheet
          completion={submissions.find((s) => s.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}
