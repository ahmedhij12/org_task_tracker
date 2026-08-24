import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function PersonalAuthScreen() {
  const c = useThemeColors();
  const { createPersonalAccount, signInPersonal } = useAuth();

  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim() && password.length >= 6;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'create') {
        await createPersonalAccount(email.trim(), password);
      } else {
        await signInPersonal(email.trim(), password);
      }
      // Root layout's Stack.Protected guard flips automatically once the
      // session (and its account_kind metadata) loads.
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
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

          <ScreenTitle>{mode === 'create' ? 'Create your personal account' : 'Sign in'}</ScreenTitle>
          <ScreenSubtitle>
            {mode === 'create'
              ? 'Just your email and a password — no organization needed.'
              : 'Use the email and password from your personal account.'}
          </ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <FieldInput label="Password" placeholder="At least 6 characters" value={password} onChangeText={setPassword} secureTextEntry />

          <View style={{ height: 8 }} />
          <PrimaryButton
            title={mode === 'create' ? 'Create account' : 'Sign in'}
            onPress={handleSubmit}
            loading={loading}
            disabled={!canSubmit}
          />

          <Pressable onPress={() => setMode(mode === 'create' ? 'signin' : 'create')} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, color: c.textMuted }}>
              {mode === 'create' ? 'Already have a personal account? ' : "Don't have one yet? "}
              <Text style={{ color: c.indigo, fontWeight: '700' }}>{mode === 'create' ? 'Sign in' : 'Create one'}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
