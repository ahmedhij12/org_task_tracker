import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { Card, FieldInput, PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { initials } from '@/lib/taskUtils';

export default function TeamsScreen() {
  const c = useThemeColors();
  const { teams, members, tasks, createTeam } = useOrgData();
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newTeamName.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await createTeam(newTeamName.trim());
      setNewTeamName('');
      setCreating(false);
    } catch (e: any) {
      setError(e?.message ?? 'Could not create team.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>Teams</Text>
          <Pressable
            onPress={() => setCreating(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.indigo, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Team</Text>
          </Pressable>
        </View>

        {teams.map((team) => {
          const teamMembers = members.filter((m) => m.teamIds.includes(team.id));
          const admin = teamMembers.find((m) => m.role === 'team_admin');
          const teamTasks = tasks.filter((t) => t.teamId === team.id);
          const pending = teamTasks.filter((t) => !t.completed).length;
          return (
            <Card key={team.id} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{team.name}</Text>
                <Text style={{ fontSize: 12, color: c.textMuted }}>{pending} pending</Text>
              </View>
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                {admin ? `Admin: ${admin.name}` : 'No team admin assigned yet'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {teamMembers.map((m) => (
                  <View
                    key={m.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      backgroundColor: c.bgSubtle,
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.indigo, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}>{initials(m.name)}</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: c.text }}>{m.name}</Text>
                    {m.role === 'team_admin' ? <Text style={{ fontSize: 9, color: c.indigo, fontWeight: '700' }}>ADMIN</Text> : null}
                  </View>
                ))}
                {teamMembers.length === 0 ? <Text style={{ fontSize: 12, color: c.textFaint }}>No members yet</Text> : null}
              </View>
            </Card>
          );
        })}
      </ScrollView>

      <Modal visible={creating} animationType="slide" transparent onRequestClose={() => setCreating(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 16 }}>New team</Text>
            {error ? <ErrorBanner message={error} /> : null}
            <FieldInput label="Team name" placeholder="e.g. Branch 2 - Downtown" value={newTeamName} onChangeText={setNewTeamName} />

            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
              After you create the team, add its leader from the People tab.
            </Text>

            <PrimaryButton title="Create team" onPress={handleCreate} loading={loading} disabled={!newTeamName.trim()} />
            <View style={{ height: 10 }} />
            <SecondaryButton title="Cancel" onPress={() => setCreating(false)} />
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
