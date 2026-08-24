import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Card } from '@/components/ui';
import { usePersonalTasks } from '@/hooks/usePersonalTasks';
import { PersonalTaskSheet } from '@/components/PersonalTaskSheet';
import { formatDue } from '@/lib/taskUtils';
import type { PersonalTask } from '@/types';

export default function PersonalHome() {
  const c = useThemeColors();
  const { tasks, loading, refresh, createTask, setCompletion, deleteTask } = usePersonalTasks();
  const [creating, setCreating] = useState(false);
  // Which row (if any) is showing its inline delete confirmation. A single
  // tap on the trash icon used to delete immediately with no confirmation —
  // this tracks the two-step in-app confirmation instead, matching the
  // pattern already used for sign-out in settings.tsx. Deliberately not
  // Alert.alert: this project has a documented history of Alert.alert
  // silently doing nothing on web (see ROADMAP.md).
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  const handleConfirmDelete = (id: string) => {
    deleteTask(id).catch((e) => console.warn(e));
    setConfirmingDeleteId(null);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.indigo} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>My Tasks</Text>
          <Pressable onPress={() => router.push('/(personal)/settings')}>
            <Ionicons name="settings-outline" size={22} color={c.textMuted} />
          </Pressable>
        </View>

        {tasks.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 30 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: c.bgSubtle,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <Ionicons name="checkbox-outline" size={28} color={c.indigo} />
            </View>
            <Text style={{ fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 19 }}>
              Nothing here yet. Tap + to add something you don't want to forget.
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
              Open
            </Text>
            {open.map((t) => (
              <PersonalTaskRow
                key={t.id}
                task={t}
                confirmingDelete={confirmingDeleteId === t.id}
                onToggle={() => setCompletion(t.id, true).catch((e) => console.warn(e))}
                onRequestDelete={() => setConfirmingDeleteId(t.id)}
                onCancelDelete={() => setConfirmingDeleteId(null)}
                onConfirmDelete={() => handleConfirmDelete(t.id)}
              />
            ))}

            {done.length > 0 ? (
              <>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginTop: 24, marginBottom: 8 }}>
                  Done
                </Text>
                {done.map((t) => (
                  <PersonalTaskRow
                    key={t.id}
                    task={t}
                    confirmingDelete={confirmingDeleteId === t.id}
                    onToggle={() => setCompletion(t.id, false).catch((e) => console.warn(e))}
                    onRequestDelete={() => setConfirmingDeleteId(t.id)}
                    onCancelDelete={() => setConfirmingDeleteId(null)}
                    onConfirmDelete={() => handleConfirmDelete(t.id)}
                  />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <Pressable
        onPress={() => setCreating(true)}
        accessibilityRole="button"
        accessibilityLabel="Add task"
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

      <PersonalTaskSheet visible={creating} onCancel={() => setCreating(false)} onSubmit={async (args) => {
        await createTask(args);
        setCreating(false);
      }} />
    </SafeAreaView>
  );
}

function PersonalTaskRow({
  task,
  confirmingDelete,
  onToggle,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  task: PersonalTask;
  confirmingDelete: boolean;
  onToggle: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const c = useThemeColors();
  const overdue = !task.completed && task.due && new Date(task.due) < new Date();

  if (confirmingDelete) {
    return (
      <Card style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 13, color: c.text, marginBottom: 12 }}>Delete "{task.title}"? This can't be undone.</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={onCancelDelete} style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ color: c.textMuted, fontSize: 14 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={onConfirmDelete} style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ color: c.rose, fontSize: 14, fontWeight: '700' }}>Delete</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.completed }}
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: task.completed ? c.indigo : c.border,
          backgroundColor: task.completed ? c.indigo : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {task.completed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            color: task.completed ? c.textMuted : c.text,
            textDecorationLine: task.completed ? 'line-through' : 'none',
          }}
        >
          {task.title}
        </Text>
        {task.due ? (
          <Text style={{ fontSize: 12, color: overdue ? c.rose : c.textMuted, marginTop: 2 }}>{formatDue(task.due)}</Text>
        ) : null}
      </View>
      <Pressable onPress={onRequestDelete} hitSlop={8}>
        <Ionicons name="trash-outline" size={18} color={c.textFaint} />
      </Pressable>
    </Card>
  );
}
