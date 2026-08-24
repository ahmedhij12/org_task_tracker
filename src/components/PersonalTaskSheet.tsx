import { useState } from 'react';
import { Modal, View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useThemeColors, FieldInput, PrimaryButton, SecondaryButton, ErrorBanner } from '@/components/ui';
import { DueDateField } from '@/components/DueDateField';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onSubmit: (args: { title: string; notes?: string; due?: string | null }) => Promise<void>;
}

export function PersonalTaskSheet({ visible, onCancel, onSubmit }: Props) {
  const c = useThemeColors();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [due, setDue] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setNotes('');
    setDue(null);
    setError(null);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleSubmit = async () => {
    if (!title.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), notes: notes.trim() || undefined, due: due ? due.toISOString() : null });
      reset();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save this task.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '90%', flexShrink: 1 }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: c.text }}>New task</Text>
              <Pressable onPress={handleCancel}>
                <Text style={{ fontSize: 14, color: c.textMuted }}>Cancel</Text>
              </Pressable>
            </View>

            {error ? <ErrorBanner message={error} /> : null}

            <FieldInput label="Title" placeholder="e.g. Call the accountant" value={title} onChangeText={setTitle} />
            <FieldInput label="Notes (optional)" placeholder="Any details" value={notes} onChangeText={setNotes} multiline />
            <DueDateField value={due} onChange={setDue} />

            <View style={{ height: 8 }} />
            <PrimaryButton title="Save task" onPress={handleSubmit} loading={loading} disabled={!title.trim()} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
