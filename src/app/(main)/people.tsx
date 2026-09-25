import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MenuButton } from '@/components/SideMenu';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { CreateUserSheet } from '@/components/CreateUserSheet';
import { ManageUserSheet } from '@/components/ManageUserSheet';
import { Card, useThemeColors } from '@/components/ui';
import { ON_ACCENT } from '@/theme';
import { initials } from '@/lib/taskUtils';
import type { Profile } from '@/types';

function roleLabel(member: Profile, t: (key: string) => string): string {
  if (member.isSuperAdmin) return t('people.roleSuperAdmin');
  if (member.role === 'owner') return t('people.roleOwner');
  if (member.role === 'team_admin') return t('people.roleTeamAdmin');
  if (member.role === 'hygiene_auditor') return t('people.roleHygieneAuditor');
  return t('people.roleEmployee');
}

// A dedicated bucket, distinct from any real team id: everyone who belongs to
// no branch at all — the owners, who run the whole org, and anyone not yet
// assigned. Grouping staff by branch only makes sense for people a branch
// actually has, so the branchless get their own section instead of being
// forced under a branch or silently dropped. Membership is what decides this,
// NOT the role: a branch manager belongs to a branch and is listed there, and
// listing him here as well put the same person on screen twice.
const ADMIN_GROUP_ID = '__admin__';

export default function PeopleScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { members, teams } = useOrgData();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Profile | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const isOwner = profile?.role === 'owner';
  // An owner manages the whole org; a team leader only people who share at
  // least one team with them (a multi-team employee can show up for more
  // than one leader).
  const visible = isOwner
    ? members
    : members.filter((m) => m.id !== profile?.id && m.teamIds.some((t) => profile?.teamIds.includes(t)));

  // One group per branch (a member with more than one branch shows up in
  // each — the same accepted edge case the monthly report already has),
  // plus the admin/unassigned bucket. New branches appear automatically:
  // this just reads the live teams list.
  const groups = [
    ...teams.map((team) => ({
      id: team.id,
      name: team.name,
      members: visible.filter((m) => m.teamIds.includes(team.id)),
    })),
    {
      id: ADMIN_GROUP_ID,
      name: t('people.adminGroup'),
      members: visible.filter((m) => m.teamIds.length === 0),
    },
  ].filter((g) => g.members.length > 0);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <MenuButton />
            <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('people.title')}</Text>
          </View>
          {/* Only the admin adds staff; branch managers just see their team. */}
          {isOwner ? (
          <Pressable
            onPress={() => setCreating(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: c.accent,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Ionicons name="add" size={16} color={ON_ACCENT} />
            <Text style={{ color: ON_ACCENT, fontSize: 13, fontWeight: '700' }}>{t('people.addStaff')}</Text>
          </Pressable>
          ) : null}
        </View>

        {visible.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textFaint }}>
            {/* A branch manager has no "Add staff" button, so telling him to tap it
                was an instruction he could not follow. */}
            {isOwner ? t('people.emptyState', { addStaff: t('people.addStaff') }) : t('people.emptyStateManager')}
          </Text>
        ) : null}

        {groups.map((group) => {
          const isOpen = expanded.has(group.id);
          return (
            <View key={group.id} style={{ marginBottom: 10 }}>
              <Pressable onPress={() => toggle(group.id)}>
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name={group.id === ADMIN_GROUP_ID ? 'shield-outline' : 'business-outline'} size={18} color={c.brand} />
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: c.text }}>{group.name}</Text>
                    <Text style={{ fontSize: 12, color: c.textMuted }}>{group.members.length}</Text>
                    <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={c.textFaint} />
                  </View>
                </Card>
              </Pressable>

              {isOpen ? (
                <View style={{ marginTop: 6, gap: 8 }}>
                  {group.members.map((m) => {
                    const memberTeams = teams.filter((tm) => m.teamIds.includes(tm.id));
                    return (
                      <Pressable key={m.id} onPress={() => setManaging(m)}>
                        <Card>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            {m.avatarUrl ? (
                              <Image source={{ uri: m.avatarUrl }} style={{ width: 40, height: 40, borderRadius: 20, opacity: m.active ? 1 : 0.5 }} />
                            ) : (
                              <View
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 20,
                                  backgroundColor: m.active ? c.brand : c.textFaint,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{initials(m.name)}</Text>
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{m.name}</Text>
                              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                                {m.username ? `@${m.username} • ` : ''}
                                {roleLabel(m, t)}
                                {memberTeams.length > 0 ? ` • ${memberTeams.map((team) => team.name).join(', ')}` : ''}
                              </Text>
                            </View>
                            {!m.active ? (
                              <Text style={{ fontSize: 10, fontWeight: '700', color: c.rose }}>{t('people.inactiveBadge')}</Text>
                            ) : m.mustChangePassword ? (
                              <Text style={{ fontSize: 10, fontWeight: '700', color: c.textFaint }}>{t('people.newBadge')}</Text>
                            ) : null}
                            <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                          </View>
                        </Card>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <CreateUserSheet visible={creating} onClose={() => setCreating(false)} />
      <ManageUserSheet member={managing} onClose={() => setManaging(null)} />
    </SafeAreaView>
  );
}
