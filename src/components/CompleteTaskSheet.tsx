import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
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
  onSubmit: (note: string, photoUrls: string[]) => Promise<void>;
}

interface Shot {
  uri: string;
  base64: string;
}

const MAX_PHOTOS = 6;

export function CompleteTaskSheet({ task, orgId, visible, onCancel, onSubmit }: Props) {
  const c = useThemeColors();
  const [note, setNote] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Camera only, never the photo library: the point of proof is that the
  // picture was taken at the moment the work was finished, not chosen from
  // whatever is already on the phone.
  const takePhoto = async () => {
    setError(null);
    if (shots.length >= MAX_PHOTOS) {
      setError(`You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Camera access is needed to take proof photos. Enable it for OrgTasks in your device settings.');
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.5,
        base64: true,
      });
      if (!result.canceled && result.assets[0]?.base64) {
        setShots((prev) => [...prev, { uri: result.assets[0].uri, base64: result.assets[0].base64! }]);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not open the camera on this device.');
    }
  };

  const removeShot = (index: number) => {
    setShots((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  const needsPhoto = task.requiresProof && shots.length === 0;
  const canSubmit = !needsPhoto && !uploading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setUploading(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < shots.length; i += 1) {
        const path = `${orgId}/${task.id}-${Date.now()}-${i}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('task-proofs')
          .upload(path, decode(shots[i].base64), { contentType: 'image/jpeg' });
        if (uploadError) throw uploadError;
        const { data: publicUrl } = supabase.storage.from('task-proofs').getPublicUrl(path);
        urls.push(publicUrl.publicUrl);
      }
      await onSubmit(note.trim(), urls);
      setNote('');
      setShots([]);
    } catch (e: any) {
      setError(e?.message ?? 'Could not complete this task. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ maxHeight: '90%', flexShrink: 1 }}
        >
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
            <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1, minHeight: 0 }}>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}
              >
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{task.title}</Text>
                <Pressable onPress={onCancel} hitSlop={8}>
                  <Ionicons name="close" size={24} color={c.textMuted} />
                </Pressable>
              </View>
              <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 16 }}>
                {task.requiresProof
                  ? 'This task needs at least one photo, taken now, before it can be marked done.'
                  : 'Add a note or photos if you want, then mark it done.'}
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

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: c.text }}>
                  Proof photos{task.requiresProof ? ' (required)' : ''}
                </Text>
                <Text style={{ fontSize: 12, color: c.textFaint }}>
                  {shots.length} of {MAX_PHOTOS}
                </Text>
              </View>

              {shots.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {shots.map((s, i) => (
                    <View key={s.uri + i} style={{ position: 'relative' }}>
                      <Image source={{ uri: s.uri }} style={{ width: 96, height: 96, borderRadius: 12 }} resizeMode="cover" />
                      <Pressable
                        onPress={() => removeShot(i)}
                        hitSlop={6}
                        style={{
                          position: 'absolute',
                          top: -6,
                          right: -6,
                          backgroundColor: c.rose,
                          borderRadius: 999,
                          width: 22,
                          height: 22,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="close" size={14} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              {shots.length < MAX_PHOTOS ? (
                <Pressable
                  onPress={takePhoto}
                  style={{
                    borderWidth: 1,
                    borderStyle: 'dashed',
                    borderColor: needsPhoto ? c.rose : c.border,
                    borderRadius: 14,
                    padding: 16,
                    alignItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <Ionicons name="camera" size={22} color={needsPhoto ? c.rose : c.textMuted} />
                  <Text style={{ fontSize: 13, color: needsPhoto ? c.rose : c.textMuted, marginTop: 4 }}>
                    {shots.length === 0 ? 'Take a photo' : 'Take another photo'}
                  </Text>
                </Pressable>
              ) : null}

              {uploading ? (
                <View style={{ paddingVertical: 14, alignItems: 'center' }}>
                  <ActivityIndicator color={c.indigo} />
                  <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 6 }}>Uploading photos…</Text>
                </View>
              ) : (
                <>
                  <PrimaryButton title="Mark as done" onPress={handleSubmit} disabled={!canSubmit} />
                  <View style={{ height: 10 }} />
                  <SecondaryButton title="Cancel" onPress={onCancel} />
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
