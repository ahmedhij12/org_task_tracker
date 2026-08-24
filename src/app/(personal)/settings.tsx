import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { supabase } from '@/lib/supabase';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';

export default function PersonalSettingsScreen() {
  const c = useThemeColors();
  const { session, signOut } = useAuth();
  usePushRegistration();

  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const handleChangePassword = async () => {
    if (newPassword.length < 6) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword('');
      setNotice('Password updated.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 20 }}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>

        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 20 }}>Settings</Text>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Account</Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{session?.user.email}</Text>
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
            Change password
          </Text>
          {error ? <ErrorBanner message={error} /> : null}
          {notice ? <Text style={{ color: c.indigo, fontSize: 13, marginBottom: 10 }}>{notice}</Text> : null}
          <FieldInput placeholder="New password (6+ characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
          <PrimaryButton title="Update password" onPress={handleChangePassword} loading={saving} disabled={newPassword.length < 6} />
        </Card>

        {!confirmingSignOut ? (
          <Pressable onPress={() => setConfirmingSignOut(true)} style={{ paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.rose }}>Sign out</Text>
          </Pressable>
        ) : (
          <Card style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 13, color: c.text, marginBottom: 12 }}>
              Sign out? You'll need your email and password to sign back in.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setConfirmingSignOut(false)} style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: c.textMuted, fontSize: 14 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={signOut} style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}>
                <Text style={{ color: c.rose, fontSize: 14, fontWeight: '700' }}>Sign out</Text>
              </Pressable>
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
