import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { CreateUserSheet } from '@/components/CreateUserSheet';
import { ManageUserSheet } from '@/components/ManageUserSheet';
import { Card, useThemeColors } from '@/components/ui';
import { initials } from '@/lib/taskUtils';
import type { Profile } from '@/types';

function roleLabel(role: Profile['role'], t: (key: string) => string): string {
  if (role === 'owner') return t('people.roleOwner');
  if (role === 'team_admin') return t('people.roleTeamAdmin');
  return t('people.roleEmployee');
}

export default function PeopleScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { members, teams } = useOrgData();
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Profile | null>(null);

  const isOwner = profile?.role === 'owner';
  // An owner manages the whole org; a team leader only people who share at
  // least one team with them (a multi-team employee can show up for more
  // than one leader).
  const visible = isOwner
    ? members
    : members.filter((m) => m.id !== profile?.id && m.teamIds.some((t) => profile?.teamIds.includes(t)));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('people.title')}</Text>
          <Pressable
            onPress={() => setCreating(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: c.indigo,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{t('people.addStaff')}</Text>
          </Pressable>
        </View>

        {visible.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textFaint }}>
            {t('people.emptyState', { addStaff: t('people.addStaff') })}
          </Text>
        ) : null}

        {visible.map((m) => {
          const memberTeams = teams.filter((t) => m.teamIds.includes(t.id));
          return (
            <Pressable key={m.id} onPress={() => setManaging(m)}>
              <Card style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: m.active ? c.indigo : c.textFaint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{initials(m.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{m.name}</Text>
                    <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                      {m.username ? `@${m.username} • ` : ''}
                      {roleLabel(m.role, t)}
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
      </ScrollView>

      <CreateUserSheet visible={creating} onClose={() => setCreating(false)} />
      <ManageUserSheet member={managing} onClose={() => setManaging(null)} />
    </SafeAreaView>
  );
}
