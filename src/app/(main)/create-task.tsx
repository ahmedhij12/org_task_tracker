import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
import { DueDateField } from '@/components/DueDateField';
import { CreateChecklistTemplateSheet } from '@/components/CreateChecklistTemplateSheet';
import { FieldInput, FieldLabel, PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { Priority } from '@/types';

export default function CreateTaskScreen() {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { teams, members, createTask } = useOrgData();
  const { templates } = useChecklists();
  const isOwner = profile?.role === 'owner';

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [teamId, setTeamId] = useState<string>(profile?.teamIds[0] ?? teams[0]?.id ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(null); // null = everyone, plain tasks only
  const [priority, setPriority] = useState<Priority>('medium');
  const [manualRequiresReview, setManualRequiresReview] = useState(false); // only used at medium priority
  const [requiresProof, setRequiresProof] = useState(false);
  const [due, setDue] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [cooldownHours, setCooldownHours] = useState('24');
  const [checklistAssigneeIds, setChecklistAssigneeIds] = useState<string[]>([]);
  const [creatingTemplate, setCreatingTemplate] = useState(false);

  // Priority drives whether a completion needs a leader's sign-off before
  // it's settled: never on low, always on high, a free choice on medium.
  const requiresReview = priority === 'high' ? true : priority === 'low' ? false : manualRequiresReview;

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

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const cooldownNum = parseInt(cooldownHours, 10);

  const toggleChecklistAssignee = (id: string) => {
    setChecklistAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const pickTemplate = (id: string | null) => {
    setTemplateId(id);
    setChecklistAssigneeIds([]);
    if (id) {
      const t = templates.find((tt) => tt.id === id);
      if (t && !title.trim()) setTitle(t.name);
    }
  };

  const canSubmit = templateId
    ? title.trim() && effectiveTeamId && checklistAssigneeIds.length > 0 && cooldownNum > 0
    : title.trim() && effectiveTeamId;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (templateId) {
        // Each person gets their own copy of the checklist, filled independently.
        for (const personId of checklistAssigneeIds) {
          await createTask({
            title: title.trim(),
            notes: notes.trim() || undefined,
            due: due ? due.toISOString() : null,
            priority,
            assigneeId: personId,
            requiresProof: false,
            teamId: effectiveTeamId,
            templateId,
            cooldownHours: cooldownNum,
            requiresReview,
          });
        }
      } else {
        await createTask({
          title: title.trim(),
          notes: notes.trim() || undefined,
          due: due ? due.toISOString() : null,
          priority,
          assigneeId,
          requiresProof,
          teamId: effectiveTeamId,
          templateId: null,
          cooldownHours: null,
          requiresReview,
        });
      }
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

        <View style={{ marginBottom: 14 }}>
          <FieldLabel>Use a checklist template</FieldLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => pickTemplate(null)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: templateId === null ? c.indigo : c.bgSubtle,
                  borderWidth: 1,
                  borderColor: templateId === null ? c.indigo : c.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: templateId === null ? '#fff' : c.text }}>
                  Plain task
                </Text>
              </Pressable>
              {templates.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => pickTemplate(t.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: templateId === t.id ? c.indigo : c.bgSubtle,
                    borderWidth: 1,
                    borderColor: templateId === t.id ? c.indigo : c.border,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: templateId === t.id ? '#fff' : c.text }}>
                    {t.name}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setCreatingTemplate(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: c.border,
                }}
              >
                <Ionicons name="add" size={14} color={c.textMuted} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.textMuted }}>New template</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>

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
                    setChecklistAssigneeIds([]);
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

        {templateId ? (
          <>
            <View style={{ marginBottom: 14 }}>
              <FieldLabel>Assign to (each person gets their own copy)</FieldLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {teamMembers.length === 0 ? (
                  <Text style={{ fontSize: 13, color: c.textFaint }}>Nobody available on this team yet.</Text>
                ) : null}
                {teamMembers.map((m) => {
                  const active = checklistAssigneeIds.includes(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => toggleChecklistAssignee(m.id)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: active ? c.indigo : c.bgSubtle,
                        borderWidth: 1,
                        borderColor: active ? c.indigo : c.border,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{m.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <FieldInput
              label="Reappears after (hours)"
              placeholder="24"
              value={cooldownHours}
              onChangeText={(t) => setCooldownHours(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />
            {selectedTemplate ? (
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: -8, marginBottom: 14 }}>
                {selectedTemplate.requiresNoteOnNo ? 'A note is required on every "No" answer.' : 'Notes are optional on every answer.'}
              </Text>
            ) : null}
          </>
        ) : (
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
        )}

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

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <FieldLabel>Needs a leader's review</FieldLabel>
            <Text style={{ fontSize: 12, color: c.textMuted }}>
              {priority === 'low'
                ? "Low priority never needs review — it's settled as soon as it's done."
                : priority === 'high'
                  ? "High priority always needs a leader to review it before it's settled."
                  : "Your choice — whether a leader needs to review before it's settled."}
            </Text>
          </View>
          <Switch
            value={requiresReview}
            onValueChange={setManualRequiresReview}
            disabled={priority !== 'medium'}
            trackColor={{ true: c.indigo }}
          />
        </View>

        <DueDateField value={due} onChange={setDue} />

        {!templateId ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <View style={{ flex: 1 }}>
              <FieldLabel>Requires proof</FieldLabel>
              <Text style={{ fontSize: 12, color: c.textMuted }}>
                At least one photo, taken with the camera at the time, before this can be marked done.
              </Text>
            </View>
            <Switch value={requiresProof} onValueChange={setRequiresProof} trackColor={{ true: c.indigo }} />
          </View>
        ) : null}

        <PrimaryButton title="Create task" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        <View style={{ height: 10 }} />
        <SecondaryButton title="Cancel" onPress={() => router.back()} />
      </ScrollView>
      </KeyboardAvoidingView>

      <CreateChecklistTemplateSheet
        visible={creatingTemplate}
        onClose={() => setCreatingTemplate(false)}
      />
    </SafeAreaView>
  );
}
