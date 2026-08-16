import { useState } from 'react';
import { View, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, UsernameInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';
import { sanitizeOrgCode } from '@/lib/orgCode';

export default function SignInScreen() {
  const c = useThemeColors();
  const { signInWithUsername } = useAuth();

  const [orgCode, setOrgCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = orgCode.trim() && username.trim() && password.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await signInWithUsername(orgCode.trim(), username.trim(), password);
      // Root layout's Stack.Protected guard flips automatically once profile loads.
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign in. Check your Organization ID, username, and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={{ marginBottom: 20 }}>
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </Pressable>

          <ScreenTitle>Sign in</ScreenTitle>
          <ScreenSubtitle>Use the Organization ID and username you set up when you joined.</ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label="Organization ID"
            placeholder="e.g. 48213"
            value={orgCode}
            onChangeText={(t) => setOrgCode(sanitizeOrgCode(t))}
            keyboardType="number-pad"
          />
          <UsernameInput value={username} onChangeText={setUsername} />
          <FieldInput label="Password" placeholder="Your password" value={password} onChangeText={setPassword} secureTextEntry />

          <View style={{ height: 8 }} />
          <PrimaryButton title="Sign in" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
