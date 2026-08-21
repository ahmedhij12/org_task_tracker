import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { CompletionDetailSheet } from '@/components/CompletionDetailSheet';
import { Card, useThemeColors } from '@/components/ui';
import { isFailed, needsReview } from '@/types';
import type { OrgTask, TaskCompletion } from '@/types';

type Filter = 'all' | 'review' | 'done' | 'late' | 'failed';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function HistoryScreen() {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { history, tasks, members, loading, refresh } = useOrgData();
  const [filter, setFilter] = useState<Filter>('all');
  const [openEntry, setOpenEntry] = useState<TaskCompletion | null>(null);

  const isOwner = profile?.role === 'owner';
  const isLeader = profile?.role === 'team_admin';
  const isManager = isOwner || isLeader;

  // Failed is derived, never stored: still open and past its deadline. Scoped
  // the same way the history rows are, so each role sees a consistent picture.
  const failedTasks = useMemo(() => {
    const visible = tasks.filter((t) => {
      if (isOwner) return true;
      if (isLeader) return !!profile?.teamIds.includes(t.teamId);
      return t.assigneeId === profile?.id || t.assigneeId === null;
    });
    return visible.filter((t) => isFailed(t));
  }, [tasks, isOwner, isLeader, profile?.teamIds, profile?.id]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const needsReviewEntries = useMemo(() => {
    if (!isManager) return [];
    return history.filter((h) => needsReview(h, taskById.get(h.taskId) ?? { requiresReview: false }));
  }, [history, isManager, taskById]);

  const shown = useMemo(() => {
    if (filter === 'failed') return [];
    if (filter === 'review') return needsReviewEntries;
    return history.filter((h) => {
      if (h.action !== 'completed') return filter === 'all';
      if (filter === 'late') return h.wasLate;
      return true;
    });
  }, [history, filter, needsReviewEntries]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';

  const scopeNote = isOwner
    ? 'Everything across the organization.'
    : isLeader
      ? 'Everything your team has done.'
      : 'Everything you have done.';

  const counts = {
    review: needsReviewEntries.length,
    done: history.filter((h) => h.action === 'completed').length,
    late: history.filter((h) => h.action === 'completed' && h.wasLate).length,
    failed: failedTasks.length,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.indigo} />}
      >
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>History</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2, marginBottom: 16 }}>{scopeNote}</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {(
            [
              { key: 'all', label: 'All' },
              ...(isManager ? [{ key: 'review' as Filter, label: `Needs review (${counts.review})` }] : []),
              { key: 'done', label: `Done (${counts.done})` },
              { key: 'late', label: `Late (${counts.late})` },
              { key: 'failed', label: `Missed (${counts.failed})` },
            ] as { key: Filter; label: string }[]
          ).map((opt) => {
            const active = filter === opt.key;
            const isReviewChip = opt.key === 'review';
            return (
              <Pressable
                key={opt.key}
                onPress={() => setFilter(opt.key)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: active ? c.indigo : isReviewChip && counts.review > 0 ? c.amberSoft : c.bgSubtle,
                  borderWidth: 1,
                  borderColor: active ? c.indigo : isReviewChip && counts.review > 0 ? c.amber : c.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: active ? '#fff' : isReviewChip && counts.review > 0 ? c.amber : c.text,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filter === 'failed' ? (
          failedTasks.length === 0 ? (
            <Text style={{ fontSize: 13, color: c.textFaint }}>Nothing was missed. Every deadline so far was met.</Text>
          ) : (
            failedTasks.map((t) => <MissedRow key={t.id} task={t} nameOf={nameOf} />)
          )
        ) : shown.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.textFaint }}>
            {filter === 'review'
              ? 'Nothing waiting on your review right now.'
              : 'Nothing here yet. Completed tasks and their photos show up as soon as work gets done.'}
          </Text>
        ) : (
          shown.map((h) => (
            <HistoryRow
              key={h.id}
              entry={h}
              task={taskById.get(h.taskId)}
              actorName={nameOf(h.actorId)}
              onPress={() => setOpenEntry(h)}
            />
          ))
        )}
      </ScrollView>

      <CompletionDetailSheet completion={openEntry} onClose={() => setOpenEntry(null)} />
    </SafeAreaView>
  );
}

function MissedRow({ task, nameOf }: { task: OrgTask; nameOf: (id: string) => string }) {
  const c = useThemeColors();
  return (
    <Card style={{ marginBottom: 8, borderColor: c.roseSoft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="alert-circle" size={18} color={c.rose} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{task.title}</Text>
          <Text style={{ fontSize: 12, color: c.rose, marginTop: 2 }}>
            Was due {when(task.due!)} • still not done
          </Text>
          <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 2 }}>
            {task.assigneeId ? nameOf(task.assigneeId) : 'Anyone on the team'}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function HistoryRow({
  entry,
  task,
  actorName,
  onPress,
}: {
  entry: TaskCompletion;
  task: OrgTask | undefined;
  actorName: string;
  onPress: () => void;
}) {
  const c = useThemeColors();
  const isOffDuty = entry.action === 'off_duty';
  const reopened = entry.action === 'reopened';
  const isChecklist = entry.yesCount != null;
  const pendingReview = needsReview(entry, task ?? { requiresReview: false });

  const icon = isOffDuty
    ? entry.status === 'off_duty_approved'
      ? 'checkmark-circle'
      : entry.status === 'off_duty_rejected'
        ? 'close-circle'
        : 'time'
    : reopened
      ? 'refresh-circle'
      : entry.wasLate
        ? 'time'
        : 'checkmark-circle';
  const iconColor = isOffDuty
    ? entry.status === 'off_duty_approved'
      ? c.emerald
      : entry.status === 'off_duty_rejected'
        ? c.rose
        : c.amber
    : reopened
      ? c.textMuted
      : entry.wasLate
        ? c.amber
        : c.emerald;

  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: 8, borderColor: pendingReview ? c.amberSoft : c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Ionicons name={icon as any} size={18} color={iconColor} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{entry.taskTitle}</Text>
              {pendingReview ? (
                <View style={{ backgroundColor: c.amberSoft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: c.amber }}>NEEDS REVIEW</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
              {isOffDuty ? 'Off duty claimed' : reopened ? 'Reopened' : 'Done'} by {actorName} • {when(entry.createdAt)}
              {isChecklist ? ` • ${entry.yesCount} yes / ${entry.noCount} no` : ''}
            </Text>
            {entry.wasLate && entry.action === 'completed' ? (
              <Text style={{ fontSize: 11, color: c.rose, marginTop: 2 }}>
                Late — deadline was {entry.dueAt ? when(entry.dueAt) : 'earlier'}
              </Text>
            ) : null}
            {isOffDuty ? (
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }} numberOfLines={1}>
                "{entry.offDutyReason}"
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
        </View>
      </Card>
    </Pressable>
  );
}
