import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { DueDateField } from '@/components/DueDateField';
import { FieldInput, FieldLabel, PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { Priority } from '@/types';

export default function CreateTaskScreen() {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { teams, members, createTask } = useOrgData();
  const isOwner = profile?.role === 'owner';

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [teamId, setTeamId] = useState<string>(profile?.teamIds[0] ?? teams[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(null); // null = everyone
  const [priority, setPriority] = useState<Priority>('medium');
  const [requiresProof, setRequiresProof] = useState(false);
  const [due, setDue] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveTeamId = teamId || profile?.teamIds[0] || teams[0]?.id || '';
  // Work is handed down, never sideways or to yourself. An owner may assign to
  // team leaders and employees; a team leader only to their own employees, so
  // nobody ends up signing off on their own work. Mirrored in the RLS policy.
  // A multi-team employee shows up here whenever this is one of their teams.
  const teamMembers = members.filter((m) => {
    if (!m.teamIds.includes(effectiveTeamId)) return false;
    if (m.id === profile?.id) return false;
    if (m.role === 'owner') return false;
    if (isOwner) return true;
    return m.role === 'employee';
  });

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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
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

        <DueDateField value={due} onChange={setDue} />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <View style={{ flex: 1 }}>
            <FieldLabel>Requires proof</FieldLabel>
            <Text style={{ fontSize: 12, color: c.textMuted }}>
              At least one photo, taken with the camera at the time, before this can be marked done.
            </Text>
          </View>
          <Switch value={requiresProof} onValueChange={setRequiresProof} trackColor={{ true: c.indigo }} />
        </View>

        <PrimaryButton title="Create task" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        <View style={{ height: 10 }} />
        <SecondaryButton title="Cancel" onPress={() => router.back()} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
