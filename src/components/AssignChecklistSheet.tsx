import { useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { useChecklists } from '@/hooks/useChecklists';
import { Card, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { initials } from '@/lib/taskUtils';
import type { ChecklistTemplate } from '@/types';

interface Props {
  template: ChecklistTemplate | null;
  onClose: () => void;
}

export function AssignChecklistSheet({ template, onClose }: Props) {
  const c = useThemeColors();
  const { profile } = useAuth();
  const { members } = useOrgData();
  const { assignments, assignChecklist } = useChecklists();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!template) return null;

  const isOwner = profile?.role === 'owner';
  // Same downward-only rule as everywhere else: an owner may assign to team
  // leaders and employees, a team leader only to their own employees.
  const candidates = members.filter((m) => {
    if (m.id === profile?.id) return false;
    if (m.role === 'owner') return false;
    if (isOwner) return true;
    return m.role === 'employee' && m.teamIds.some((t) => profile?.teamIds.includes(t));
  });

  const assignedIds = new Set(
    assignments.filter((a) => a.templateId === template.id).map((a) => a.assigneeId)
  );

  const handleAssign = async (assigneeId: string) => {
    setLoading(assigneeId);
    setError(null);
    try {
      await assignChecklist(template.id, assigneeId);
    } catch (e: any) {
      setError(e?.message ?? 'Could not assign this checklist.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 32,
              maxHeight: '80%',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>Assign "{template.name}"</Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={24} color={c.textMuted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
              Each person gets their own copy, filled independently.
            </Text>

            {error ? <ErrorBanner message={error} /> : null}

            <ScrollView>
              {candidates.length === 0 ? (
                <Text style={{ fontSize: 13, color: c.textFaint }}>Nobody available to assign yet.</Text>
              ) : null}
              {candidates.map((m) => {
                const already = assignedIds.has(m.id);
                return (
                  <Card key={m.id} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          backgroundColor: c.indigo,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{initials(m.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: c.text }}>{m.name}</Text>
                        <Text style={{ fontSize: 11, color: c.textMuted }}>{m.title || m.role}</Text>
                      </View>
                      {already ? (
                        <Text style={{ fontSize: 11, color: c.emerald, fontWeight: '700' }}>ASSIGNED</Text>
                      ) : (
                        <Pressable
                          onPress={() => handleAssign(m.id)}
                          disabled={loading === m.id}
                          style={{
                            backgroundColor: c.indigo,
                            borderRadius: 999,
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            opacity: loading === m.id ? 0.5 : 1,
                          }}
                        >
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Assign</Text>
                        </Pressable>
                      )}
                    </View>
                  </Card>
                );
              })}
            </ScrollView>

            <View style={{ height: 10 }} />
            <SecondaryButton title="Done" onPress={onClose} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
