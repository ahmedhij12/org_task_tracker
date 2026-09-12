import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useThemeColors } from '@/components/ui';
import { TaskRow } from '@/components/TaskRow';
import { Section } from '@/components/Section';
import { CompleteTaskSheet } from '@/components/CompleteTaskSheet';
import { FillChecklistSheet } from '@/components/FillChecklistSheet';
import { bucketTasks, effectiveTaskCompleted, latestCompletionForTask } from '@/lib/taskUtils';
import type { OrgTask } from '@/types';

export default function MainIndex() {
  const { profile } = useAuth();
  if (profile?.role === 'employee') return <EmployeeHome />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile, organization } = useAuth();
  const { tasks, teams, members, history, loading, refresh, setTaskCompletion } = useOrgData();
  const isOwner = profile?.role === 'owner';
  const [selectedTeamId, setSelectedTeamId] = useState<string | 'all'>(isOwner ? 'all' : profile?.teamIds[0] ?? 'all');
  const [copied, setCopied] = useState(false);
  const [proofTask, setProofTask] = useState<OrgTask | null>(null);
  const [checklistTask, setChecklistTask] = useState<OrgTask | null>(null);

  // An owner or team leader can also be the assignee of their own task (a
  // checklist someone above them created), so their own rows need the same
  // completable behavior as an employee's "My Tasks" list gets.
  const handlePressCheckbox = (task: OrgTask) => {
    if (task.templateId) {
      if (!task.completed) setChecklistTask(task);
      return;
    }
    if (!task.completed && task.requiresProof) {
      setProofTask(task);
      return;
    }
    setTaskCompletion(task.id, !task.completed).catch((e) => console.warn(e));
  };

  // A checklist task's own `completed` flag never resets after the first
  // submission — the DB doesn't know about cooldowns — so display state has
  // to be derived per row instead of read straight off the task.
  const scopedTasks = (selectedTeamId === 'all' ? tasks : tasks.filter((t) => t.teamId === selectedTeamId)).map((t) => ({
    ...t,
    completed: effectiveTaskCompleted(t, history),
  }));
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
                <Text style={{ fontSize: 10, fontWeight: '700', color: c.indigo }}>
                  {isOwner ? t('dashboard.ownerBadge') : t('dashboard.teamAdminBadge')}
                </Text>
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
          <StatChip label={t('dashboard.statPending')} value={pending} color={c.indigo} bg={c.indigoSoft} />
          {overdueCount > 0 ? <StatChip label={t('dashboard.statOverdue')} value={overdueCount} color={c.rose} bg={c.roseSoft} /> : null}
          <StatChip label={t('dashboard.statDone')} value={doneCount} color={c.emerald} bg={c.emeraldSoft} />
        </View>

        {isOwner && teams.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16 }} contentContainerStyle={{ gap: 8 }}>
            <TeamChip label={t('dashboard.allTeams')} active={selectedTeamId === 'all'} onPress={() => setSelectedTeamId('all')} />
            {teams.map((tm) => (
              <TeamChip key={tm.id} label={tm.name} active={selectedTeamId === tm.id} onPress={() => setSelectedTeamId(tm.id)} />
            ))}
          </ScrollView>
        ) : null}

        <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
          {t('dashboard.taskFeed')}
        </Text>

        {(() => {
          // Finished work belongs in History, not the live feed — otherwise
          // the dashboard just accumulates every task ever created. A task
          // that requires review isn't actually settled until reviewed, so
          // it stays here even after the employee marks it done.
          const openTasks = scopedTasks.filter((t) => {
            if (!t.completed) return true;
            if (!t.requiresReview) return false;
            return !latestCompletionForTask(t.id, history)?.reviewedBy;
          });
          return openTasks.length === 0 ? (
            <EmptyState text={t('dashboard.noOpenTasks')} />
          ) : (
            openTasks
              .slice()
              .sort((a, b) => Number(a.completed) - Number(b.completed))
              .map((t) =>
                t.assigneeId === profile?.id ? (
                  <TaskRow key={t.id} task={t} members={members} showAssignee canComplete onPressCheckbox={() => handlePressCheckbox(t)} />
                ) : (
                  <TaskRow key={t.id} task={t} members={members} showAssignee />
                )
              )
          );
        })()}
      </ScrollView>

      {proofTask ? (
        <CompleteTaskSheet
          task={proofTask}
          orgId={organization!.id}
          visible={!!proofTask}
          onCancel={() => setProofTask(null)}
          onSubmit={async (note, photoUrls) => {
            await setTaskCompletion(proofTask.id, true, note || undefined, photoUrls);
            setProofTask(null);
          }}
        />
      ) : null}
      {checklistTask ? (
        <FillChecklistSheet
          task={checklistTask}
          orgId={organization!.id}
          visible={!!checklistTask}
          onClose={() => setChecklistTask(null)}
        />
      ) : null}

      <Pressable
        onPress={() => router.push('/(main)/create-task')}
        accessibilityRole="button"
        accessibilityLabel={t('dashboard.addTask')}
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
  const { t, i18n } = useTranslation();
  const { profile, organization } = useAuth();
  const { tasks, members, history, loading, refresh, setTaskCompletion } = useOrgData();
  const [proofTask, setProofTask] = useState<OrgTask | null>(null);
  const [checklistTask, setChecklistTask] = useState<OrgTask | null>(null);

  const myTasks = tasks
    .filter((t) => t.assigneeId === profile?.id || t.assigneeId === null)
    .map((t) => ({ ...t, completed: effectiveTaskCompleted(t, history) }));
  const { overdue, today, upcoming, completed } = bucketTasks(myTasks);

  const handlePressCheckbox = (task: OrgTask) => {
    if (task.templateId) {
      // A checklist can't be unchecked by hand — it only comes due again via
      // its cooldown or a rejected off-duty claim.
      if (!task.completed) setChecklistTask(task);
      return;
    }
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
          {new Date().toLocaleDateString(i18n.language, { weekday: 'long', month: 'long', day: 'numeric' })}
        </Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginTop: 2 }}>{t('dashboard.myTasksTitle')}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{organization?.name}</Text>

        {myTasks.length === 0 ? (
          <EmptyState text={t('dashboard.nothingAssigned')} />
        ) : (
          <View style={{ marginTop: 16 }}>
            <Section title={t('dashboard.sectionOverdue')} count={overdue.length} iconColor={c.rose}>
              {overdue.map((task) => (
                <TaskRow key={task.id} task={task} members={members} showAssignee={task.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(task)} />
              ))}
            </Section>
            <Section title={t('dashboard.sectionToday')} count={today.length} iconColor={c.indigo}>
              {today.map((task) => (
                <TaskRow key={task.id} task={task} members={members} showAssignee={task.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(task)} />
              ))}
            </Section>
            <Section title={t('dashboard.sectionUpcoming')} count={upcoming.length} iconColor={c.sky} defaultOpen={false}>
              {upcoming.map((task) => (
                <TaskRow key={task.id} task={task} members={members} showAssignee={task.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(task)} />
              ))}
            </Section>
            <Section title={t('dashboard.sectionCompleted')} count={completed.length} iconColor={c.emerald} defaultOpen={false}>
              {completed.map((task) => (
                <TaskRow key={task.id} task={task} members={members} showAssignee={task.assigneeId === null} canComplete onPressCheckbox={() => handlePressCheckbox(task)} />
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
          onSubmit={async (note, photoUrls) => {
            await setTaskCompletion(proofTask.id, true, note || undefined, photoUrls);
            setProofTask(null);
          }}
        />
      ) : null}
      {checklistTask ? (
        <FillChecklistSheet
          task={checklistTask}
          orgId={organization!.id}
          visible={!!checklistTask}
          onClose={() => setChecklistTask(null)}
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
