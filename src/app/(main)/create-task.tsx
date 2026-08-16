import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { FieldInput, FieldLabel, PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { Priority } from '@/types';

export default function CreateTaskScreen() {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { teams, members, createTask } = useOrgData();
  const isOwner = profile?.role === 'owner';

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [teamId, setTeamId] = useState<string>(profile?.teamId ?? teams[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(null); // null = everyone
  const [priority, setPriority] = useState<Priority>('medium');
  const [requiresProof, setRequiresProof] = useState(false);
  const [due, setDue] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveTeamId = teamId || profile?.teamId || teams[0]?.id || '';
  const teamMembers = members.filter((m) => m.teamId === effectiveTeamId && m.role !== 'owner');

  const canSubmit = title.trim() && effectiveTeamId;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await createTask({
        title: title.trim(),
        notes: notes.trim() || undefined,
        due: due ? due.toISOString() : null,
        priority,
        assigneeId,
        requiresProof,
        teamId: effectiveTeamId,
      });
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not create this task.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="close" size={26} color={c.text} />
          </Pressable>
          <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>New Task</Text>
          <View style={{ width: 26 }} />
        </View>

        {error ? <ErrorBanner message={error} /> : null}

        <FieldInput label="Title" placeholder="e.g. Restock shelves" value={title} onChangeText={setTitle} />
        <FieldInput label="Notes (optional)" placeholder="Any details" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />

        {isOwner && teams.length > 1 ? (
          <View style={{ marginBottom: 14 }}>
            <FieldLabel>Team</FieldLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {teams.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    setTeamId(t.id);
                    setAssigneeId(null);
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: effectiveTeamId === t.id ? c.indigo : c.bgSubtle,
                    borderWidth: 1,
                    borderColor: effectiveTeamId === t.id ? c.indigo : c.border,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: effectiveTeamId === t.id ? '#fff' : c.text }}>{t.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ marginBottom: 14 }}>
          <FieldLabel>Assign to</FieldLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable
              onPress={() => setAssigneeId(null)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: assigneeId === null ? c.indigo : c.bgSubtle,
                borderWidth: 1,
                borderColor: assigneeId === null ? c.indigo : c.border,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: assigneeId === null ? '#fff' : c.text }}>Everyone</Text>
            </Pressable>
            {teamMembers.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setAssigneeId(m.id)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: assigneeId === m.id ? c.indigo : c.bgSubtle,
                  borderWidth: 1,
                  borderColor: assigneeId === m.id ? c.indigo : c.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: assigneeId === m.id ? '#fff' : c.text }}>{m.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 14 }}>
          <FieldLabel>Priority</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['low', 'medium', 'high'] as Priority[]).map((p) => (
              <Pressable
                key={p}
                onPress={() => setPriority(p)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 12,
                  alignItems: 'center',
                  backgroundColor: priority === p ? c.indigo : c.bgSubtle,
                  borderWidth: 1,
                  borderColor: priority === p ? c.indigo : c.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: priority === p ? '#fff' : c.text, textTransform: 'capitalize' }}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 14 }}>
          <FieldLabel>Due date & time (optional)</FieldLabel>
          <Pressable
            onPress={() => setShowPicker(true)}
            style={{ borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, backgroundColor: c.card }}
          >
            <Text style={{ fontSize: 14, color: due ? c.text : c.textFaint }}>
              {due ? due.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No due date'}
            </Text>
          </Pressable>
          {showPicker ? (
            <DateTimePicker
              value={due ?? new Date()}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_, selected) => {
                setShowPicker(Platform.OS === 'ios');
                if (selected) setDue(selected);
              }}
            />
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <View style={{ flex: 1 }}>
            <FieldLabel>Requires proof</FieldLabel>
            <Text style={{ fontSize: 12, color: c.textMuted }}>A note or photo is required before this can be marked done.</Text>
          </View>
          <Switch value={requiresProof} onValueChange={setRequiresProof} trackColor={{ true: c.indigo }} />
        </View>

        <PrimaryButton title="Create task" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        <View style={{ height: 10 }} />
        <SecondaryButton title="Cancel" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
