import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function ChangePasswordScreen() {
  const c = useThemeColors();
  const { changeOwnPassword, profile } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 6 && password === confirm;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await changeOwnPassword(password);
      // The root layout guard flips automatically once the profile reloads.
    } catch (e: any) {
      setError(e?.message ?? 'Could not save your new password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
          <ScreenTitle>Set your password</ScreenTitle>
          <ScreenSubtitle>
            {profile?.name ? `Welcome, ${profile.name}. ` : ''}
            Your account was set up with a temporary password. Choose your own before you continue.
          </ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label="New password"
            placeholder="At least 6 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {tooShort ? (
            <Text style={{ fontSize: 12, color: c.rose, marginTop: -8, marginBottom: 10 }}>
              Use at least 6 characters.
            </Text>
          ) : null}

          <FieldInput
            label="Confirm new password"
            placeholder="Re-enter your new password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
          />
          {mismatch ? (
            <Text style={{ fontSize: 12, color: c.rose, marginTop: -8, marginBottom: 10 }}>
              Those passwords do not match.
            </Text>
          ) : null}

          <View style={{ height: 8 }} />
          <PrimaryButton title="Save password" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
