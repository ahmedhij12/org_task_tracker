import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOrgData } from '@/hooks/useOrgData';
import { useAuth } from '@/hooks/useAuth';
import { useSupervisorChecklists } from '@/hooks/useSupervisorChecklists';
import { CompletionDetailSheet } from '@/components/CompletionDetailSheet';
import { Card, useThemeColors } from '@/components/ui';
import type { TaskCompletion } from '@/types';

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
  const isOwner = profile?.role === 'owner';
  const submissions = useSupervisorChecklists();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<TaskCompletion | null>(null);

  const branches = useMemo(() => {
    // A branch manager sees only their own branch(es), and their own
    // checklist isn't theirs to verify, so it doesn't count as waiting.
    return teams
      .filter((team) => isOwner || profile?.teamIds.includes(team.id))
      .map((team) => {
        const rows = submissions
          .filter((s) => s.teamId === team.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { team, rows, unverified: rows.filter((r) => !r.reviewedBy && (isOwner || r.actorId !== profile?.id)).length };
      })
      .sort((a, b) => b.unverified - a.unverified || a.team.name.localeCompare(b.team.name));
  }, [teams, submissions, isOwner, profile?.id, profile?.teamIds]);

  const nameOf = (id: string) => allMembers.find((m) => m.id === id)?.name ?? t('history.someone');
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.brand} />}
      >
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('checklists.title')}</Text>
        <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 18 }}>{t('checklists.subtitle')}</Text>

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
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: c.text }}>{team.name}</Text>
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
                              </View>
                              <Text style={{ fontSize: 12, color: c.textMuted }}>
                                {time(r.createdAt)}
                                {r.noCount != null ? ` · ${t('checklists.yesNo', { yes: r.yesCount ?? 0, no: r.noCount })}` : ''}
                                {r.signedAddress ? ` · ${r.signedAddress}` : ''}
                              </Text>
                            </View>
                            <View
                              style={{
                                backgroundColor: verified ? c.emeraldSoft : c.roseSoft,
                                borderRadius: 999,
                                paddingHorizontal: 8,
                                paddingVertical: 3,
                              }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '700', color: verified ? c.emerald : c.rose }}>
                                {verified ? `✓ ${t('checklists.verified')}` : t('checklists.new')}
                              </Text>
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
      </ScrollView>

      {selected ? (
        <CompletionDetailSheet
          completion={submissions.find((s) => s.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}
