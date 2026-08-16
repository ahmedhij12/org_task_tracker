import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useThemeColors, PrimaryButton, SecondaryButton, ErrorBanner } from '@/components/ui';
import type { OrgTask } from '@/types';

interface Props {
  task: OrgTask;
  orgId: string;
  visible: boolean;
  onCancel: () => void;
  onSubmit: (note: string, photoUrl: string | null) => Promise<void>;
}

export function CompleteTaskSheet({ task, orgId, visible, onCancel, onSubmit }: Props) {
  const c = useThemeColors();
  const [note, setNote] = useState('');
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [pickedBase64, setPickedBase64] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library permission is needed to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setLocalImageUri(result.assets[0].uri);
      setPickedBase64(result.assets[0].base64 ?? null);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setUploading(true);
    try {
      let photoUrl: string | null = null;
      if (pickedBase64) {
        const path = `${orgId}/${task.id}-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('task-proofs')
          .upload(path, decode(pickedBase64), { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const { data: publicUrl } = supabase.storage.from('task-proofs').getPublicUrl(path);
        photoUrl = publicUrl.publicUrl;
      }
      await onSubmit(note.trim(), photoUrl);
      setNote('');
      setLocalImageUri(null);
      setPickedBase64(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not complete this task. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{task.title}</Text>
              <Pressable onPress={onCancel} hitSlop={8}>
                <Ionicons name="close" size={24} color={c.textMuted} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 16 }}>
              This task needs proof before it can be marked done.
            </Text>

            {error ? <ErrorBanner message={error} /> : null}

            <Text style={{ fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 6 }}>Note</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="What did you do?"
              placeholderTextColor={c.textFaint}
              multiline
              style={{
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 14,
                padding: 12,
                minHeight: 80,
                fontSize: 14,
                color: c.text,
                textAlignVertical: 'top',
                marginBottom: 14,
              }}
            />

            {localImageUri ? (
              <View style={{ marginBottom: 14 }}>
                <Image source={{ uri: localImageUri }} style={{ width: '100%', height: 160, borderRadius: 14 }} resizeMode="cover" />
              </View>
            ) : (
              <Pressable
                onPress={pickImage}
                style={{
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: c.border,
                  borderRadius: 14,
                  padding: 16,
                  alignItems: 'center',
                  marginBottom: 14,
                }}
              >
                <Ionicons name="camera-outline" size={22} color={c.textMuted} />
                <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4 }}>Add a photo</Text>
              </Pressable>
            )}

            {uploading ? (
              <View style={{ paddingVertical: 14, alignItems: 'center' }}>
                <ActivityIndicator color={c.indigo} />
              </View>
            ) : (
              <>
                <PrimaryButton title="Mark as done" onPress={handleSubmit} disabled={task.requiresProof && !note.trim() && !pickedBase64} />
                <View style={{ height: 10 }} />
                <SecondaryButton title="Cancel" onPress={onCancel} />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
