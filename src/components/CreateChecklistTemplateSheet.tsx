import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useChecklists } from '@/hooks/useChecklists';
import { BUILT_IN_CHECKLISTS } from '@/lib/builtInChecklists';
import { FieldInput, FieldLabel, PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { textAlignFor } from '@/lib/rtl';
import type { ChecklistItemDraft } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Row = ChecklistItemDraft & { key: string };

let rowKeySeq = 0;
function toRows(items: ChecklistItemDraft[]): Row[] {
  return items.map((it) => ({ ...it, key: `r${rowKeySeq++}` }));
}

export function CreateChecklistTemplateSheet({ visible, onClose }: Props) {
  const c = useThemeColors();
  const { createTemplate } = useChecklists();

  const [name, setName] = useState('');
  const [requiresNoteOnNo, setRequiresNoteOnNo] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [newQuestion, setNewQuestion] = useState('');
  const [newSection, setNewSection] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setRequiresNoteOnNo(true);
    setRows([]);
    setNewQuestion('');
    setNewSection('');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickPreset = (key: 'blank' | string) => {
    if (key === 'blank') {
      setName('');
      setRows([]);
      return;
    }
    const preset = BUILT_IN_CHECKLISTS.find((p) => p.key === key);
    if (!preset) return;
    setName(preset.name);
    setRows(toRows(preset.items));
  };

  const updateQuestion = (key: string, text: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, question: text } : r)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const addQuestion = () => {
    if (!newQuestion.trim()) return;
    setRows((prev) => [...prev, { key: `r${rowKeySeq++}`, sectionTitle: newSection.trim(), question: newQuestion.trim() }]);
    setNewQuestion('');
  };

  const canSubmit = name.trim().length > 0 && rows.length > 0 && !loading;

  const handleCreate = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await createTemplate(
        name.trim(),
        requiresNoteOnNo,
        rows.map((r) => ({ sectionTitle: r.sectionTitle, question: r.question }))
      );
      handleClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not create this checklist template.');
    } finally {
      setLoading(false);
    }
  };

  // Group consecutive rows sharing a section title, purely for display —
  // renaming a preset's section isn't supported in this first cut, only
  // editing individual question text and adding/removing rows.
  const groups: { sectionTitle: string; rows: Row[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.sectionTitle === row.sectionTitle) last.rows.push(row);
    else groups.push({ sectionTitle: row.sectionTitle, rows: [row] });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ maxHeight: '92%', flexShrink: 1 }}
        >
          {/* flexShrink + minHeight: 0 is what actually lets the ScrollView below
              shrink to fit inside this card instead of growing to fit 79 questions
              worth of content — without it, maxHeight on a parent doesn't bound a
              non-flex child on web, so nothing was ever scrollable, just clipped. */}
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 32,
              flexShrink: 1,
              minHeight: 0,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>New checklist template</Text>
              <Pressable onPress={handleClose} hitSlop={8}>
                <Ionicons name="close" size={24} color={c.textMuted} />
              </Pressable>
            </View>

            {error ? <ErrorBanner message={error} /> : null}

            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1, minHeight: 0 }}>
              <FieldLabel>Start from</FieldLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                <Pressable
                  onPress={() => pickPreset('blank')}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: c.bgSubtle,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: c.text }}>Blank</Text>
                </Pressable>
                {BUILT_IN_CHECKLISTS.map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => pickPreset(p.key)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: c.bgSubtle,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: c.text }}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>

              <FieldInput label="Template name" placeholder="e.g. Daily Hygiene Checklist" value={name} onChangeText={setName} />

              <Pressable
                onPress={() => setRequiresNoteOnNo((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}
              >
                <Ionicons
                  name={requiresNoteOnNo ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={requiresNoteOnNo ? c.indigo : c.textMuted}
                />
                <Text style={{ fontSize: 13, color: c.text, flex: 1 }}>
                  Require a note when someone answers "No"
                </Text>
              </Pressable>

              <FieldLabel>Questions ({rows.length})</FieldLabel>
              {groups.map((g, gi) => (
                <View key={gi} style={{ marginBottom: 10 }}>
                  {g.sectionTitle ? (
                    <Text
                      style={{ fontSize: 12, fontWeight: '700', color: c.indigo, marginBottom: 4, textAlign: textAlignFor(g.sectionTitle) }}
                    >
                      {g.sectionTitle}
                    </Text>
                  ) : null}
                  {g.rows.map((r) => (
                    <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <TextInput
                        value={r.question}
                        onChangeText={(t) => updateQuestion(r.key, t)}
                        multiline
                        style={{
                          flex: 1,
                          borderWidth: 1,
                          borderColor: c.border,
                          borderRadius: 10,
                          padding: 8,
                          fontSize: 13,
                          color: c.text,
                          textAlign: textAlignFor(r.question),
                        }}
                      />
                      <Pressable onPress={() => removeRow(r.key)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={18} color={c.rose} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ))}

              <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, marginTop: 4, marginBottom: 16 }}>
                <FieldInput label="Section (optional)" placeholder="e.g. Kitchen" value={newSection} onChangeText={setNewSection} />
                <FieldInput label="New question" placeholder="Type a question" value={newQuestion} onChangeText={setNewQuestion} />
                <SecondaryButton title="+ Add question" onPress={addQuestion} disabled={!newQuestion.trim()} />
              </View>

              <PrimaryButton title="Create template" onPress={handleCreate} loading={loading} disabled={!canSubmit} />
              <View style={{ height: 10 }} />
              <SecondaryButton title="Cancel" onPress={handleClose} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
