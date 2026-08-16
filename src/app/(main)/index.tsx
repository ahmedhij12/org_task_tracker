import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useThemeColors } from '@/components/ui';
import { TaskRow } from '@/components/TaskRow';
import { Section } from '@/components/Section';
import { CompleteTaskSheet } from '@/components/CompleteTaskSheet';
import { bucketTasks } from '@/lib/taskUtils';
import type { OrgTask } from '@/types';

export default function MainIndex() {
  const { profile } = useAuth();
  if (profile?.role === 'employee') return <EmployeeHome />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const c = useThemeColors();
  const { profile, organization } = useAuth();
  const { tasks, teams, members, loading, refresh } = useOrgData();
  const isOwner = profile?.role === 'owner';
  const [selectedTeamId, setSelectedTeamId] = useState<string | 'all'>(isOwner ? 'all' : profile?.teamId ?? 'all');
  const [copied, setCopied] = useState(false);

  const scopedTasks = selectedTeamId === 'all' ? tasks : tasks.filter((t) => t.teamId === selectedTeamId);
  const pending = scopedTasks.filter((t) => !t.completed).length;
  const overdueCount = scopedTasks.filter((t) => !t.completed && t.due && new Date(t.due) < new Date()).length;
  const doneCount = scopedTasks.filter((t) => t.completed).length;

  const handleCopy = async () => {
    if (!organization) return;
    await Clipboard.setStringAsync(organization.orgCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.indigo} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: c.text }}>{organization?.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.indigo }}>{isOwner ? 'OWNER' : 'TEAM ADMIN'}</Text>
              </View>
              {isOwner ? (
                <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>{organization?.orgCode}</Text>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color={c.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          <StatChip label="pending" value={pending} color={c.indigo} bg={c.indigoSoft} />
          {overdueCount > 0 ? <StatChip label="overdue" value={overdueCount} color={c.rose} bg={c.roseSoft} /> : null}
          <StatChip label="done" value={doneCount} color={c.emerald} bg={c.emeraldSoft} />
        </View>

        {isOwner && teams.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 8 }}>
            <TeamChip label="All teams" active={selectedTeamId === 'all'} onPress={() => setSelectedTeamId('all')} />
            {teams.map((t) => (
              <TeamChip key={t.id} label={t.name} active={selectedTeamId === t.id} onPress={() => setSelectedTeamId(t.id)} />
            ))}
          </ScrollView>
        ) : null}

        <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
          Task feed
        </Text>

        {scopedTasks.length === 0 ? (
          <EmptyState text="No tasks yet. Tap + to create one." />
        ) : (
          scopedTasks
            .slice()
            .sort((a, b) => Number(a.completed) - Number(b.completed))
            .map((t) => <TaskRow key={t.id} task={t} members={members} showAssignee />)
        )}
      </ScrollView>

      <Pressable
        onPress={() => router.push('/(main)/create-task')}
        style={{
          position: 'absolute',
          right: 20,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.indigo,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: c.indigo,
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </SafeAreaView>
  );
}

function EmployeeHome() {
  const c = useThemeColors();
  const { profile, organization } = useAuth();
  const { tasks, members, loading, refresh, setTaskCompletion } = useOrgData();
  const [proofTask, setProofTask] = useState<OrgTask | null>(null);

  const myTasks = tasks.filter((t) => t.assigneeId === profile?.id || t.assigneeId === null);
  const { overdue, today, upcoming, completed } = bucketTasks(myTasks);

  const handlePressCheckbox = (task: OrgTask) => {
    if (!task.completed && task.requiresProof) {
      setProofTask(task);
      return;
    }
    setTaskCompletion(task.id, !task.completed).catch((e) => console.warn(e));
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.indigo} />}
      >
        <Text style={{ fontSize: 13, color: c.textFaint }}>
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginTop: 2 }}>My Tasks</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{organization?.name}</Text>

        {myTasks.length === 0 ? (
          <EmptyState text="Nothing assigned yet. When your admin assigns a task, it'll show up here." />
        ) : (
          <View style={{ marginTop: 16 }}>
            <Section title="Overdue" count={overdue.length} iconColor={c.rose}>
              {overdue.map((t) => (
                <TaskRow key={t.id} task={t} members={members} showAssignee={t.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(t)} />
              ))}
            </Section>
            <Section title="Today" count={today.length} iconColor={c.indigo}>
              {today.map((t) => (
                <TaskRow key={t.id} task={t} members={members} showAssignee={t.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(t)} />
              ))}
            </Section>
            <Section title="Upcoming" count={upcoming.length} iconColor={c.sky} defaultOpen={false}>
              {upcoming.map((t) => (
                <TaskRow key={t.id} task={t} members={members} showAssignee={t.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(t)} />
              ))}
            </Section>
            <Section title="Completed" count={completed.length} iconColor={c.emerald} defaultOpen={false}>
              {completed.map((t) => (
                <TaskRow key={t.id} task={t} members={members} showAssignee={t.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(t)} />
              ))}
            </Section>
          </View>
        )}
      </ScrollView>

      {proofTask ? (
        <CompleteTaskSheet
          task={proofTask}
          orgId={organization!.id}
          visible={!!proofTask}
          onCancel={() => setProofTask(null)}
          onSubmit={async (note, photoUrl) => {
            await setTaskCompletion(proofTask.id, true, note || undefined, photoUrl || undefined);
            setProofTask(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function StatChip({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexDirection: 'row', gap: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 12, color }}>{label}</Text>
    </View>
  );
}

function TeamChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? c.indigo : c.bgSubtle,
        borderWidth: 1,
        borderColor: active ? c.indigo : c.border,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ text }: { text: string }) {
  const c = useThemeColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Ionicons name="checkbox-outline" size={28} color={c.indigo} />
      </View>
      <Text style={{ fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 }}>{text}</Text>
    </View>
  );
}
