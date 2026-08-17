import { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { Card, useThemeColors } from '@/components/ui';
import { isFailed } from '@/types';
import type { OrgTask, TaskCompletion } from '@/types';

type Filter = 'all' | 'done' | 'late' | 'failed';

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
  const [openId, setOpenId] = useState<string | null>(null);

  const isOwner = profile?.role === 'owner';
  const isLeader = profile?.role === 'team_admin';

  // Failed is derived, never stored: still open and past its deadline. Scoped
  // the same way the history rows are, so each role sees a consistent picture.
  const failedTasks = useMemo(() => {
    const visible = tasks.filter((t) => {
      if (isOwner) return true;
      if (isLeader) return t.teamId === profile?.teamId;
      return t.assigneeId === profile?.id || t.assigneeId === null;
    });
    return visible.filter((t) => isFailed(t));
  }, [tasks, isOwner, isLeader, profile?.teamId, profile?.id]);

  const shown = useMemo(() => {
    if (filter === 'failed') return [];
    return history.filter((h) => {
      if (h.action !== 'completed') return filter === 'all';
      if (filter === 'late') return h.wasLate;
      return true;
    });
  }, [history, filter]);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone';

  const scopeNote = isOwner
    ? 'Everything across the organization.'
    : isLeader
      ? 'Everything your team has done.'
      : 'Everything you have done.';

  const counts = {
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
              { key: 'done', label: `Done (${counts.done})` },
              { key: 'late', label: `Late (${counts.late})` },
              { key: 'failed', label: `Missed (${counts.failed})` },
            ] as { key: Filter; label: string }[]
          ).map((opt) => {
            const active = filter === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setFilter(opt.key)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: active ? c.indigo : c.bgSubtle,
                  borderWidth: 1,
                  borderColor: active ? c.indigo : c.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{opt.label}</Text>
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
            Nothing here yet. Completed tasks and their photos show up as soon as work gets done.
          </Text>
        ) : (
          shown.map((h) => (
            <HistoryRow
              key={h.id}
              entry={h}
              actorName={nameOf(h.actorId)}
              open={openId === h.id}
              onToggle={() => setOpenId(openId === h.id ? null : h.id)}
            />
          ))
        )}
      </ScrollView>
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
  actorName,
  open,
  onToggle,
}: {
  entry: TaskCompletion;
  actorName: string;
  open: boolean;
  onToggle: () => void;
}) {
  const c = useThemeColors();
  const reopened = entry.action === 'reopened';
  const hasDetail = !!entry.note || entry.photoUrls.length > 0;

  return (
    <Card style={{ marginBottom: 8 }}>
      <Pressable onPress={hasDetail ? onToggle : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Ionicons
            name={reopened ? 'refresh-circle' : entry.wasLate ? 'time' : 'checkmark-circle'}
            size={18}
            color={reopened ? c.textMuted : entry.wasLate ? c.amber : c.emerald}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{entry.taskTitle}</Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
              {reopened ? 'Reopened' : 'Done'} by {actorName} • {when(entry.createdAt)}
            </Text>
            {entry.wasLate && !reopened ? (
              <Text style={{ fontSize: 11, color: c.rose, marginTop: 2 }}>
                Late — deadline was {entry.dueAt ? when(entry.dueAt) : 'earlier'}
              </Text>
            ) : null}
            {hasDetail ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                {entry.photoUrls.length > 0 ? <Ionicons name="image-outline" size={11} color={c.textFaint} /> : null}
                {entry.note ? <Ionicons name="document-text-outline" size={11} color={c.textFaint} /> : null}
                <Text style={{ fontSize: 11, color: c.textFaint }}>
                  {entry.photoUrls.length > 0
                    ? `Tap to view ${entry.photoUrls.length} photo${entry.photoUrls.length === 1 ? '' : 's'}`
                    : 'Tap to view the note'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>

      {open && hasDetail ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, marginTop: 10, paddingTop: 10 }}>
          {entry.photoUrls.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {entry.photoUrls.map((url) => (
                  <Image
                    key={url}
                    source={{ uri: url }}
                    style={{ width: entry.photoUrls.length === 1 ? 260 : 160, height: 160, borderRadius: 12 }}
                    resizeMode="cover"
                  />
                ))}
              </View>
            </ScrollView>
          ) : null}
          {entry.note ? <Text style={{ fontSize: 13, color: c.textMuted }}>"{entry.note}"</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}
