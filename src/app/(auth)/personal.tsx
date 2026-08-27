import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function PersonalAuthScreen() {
  const c = useThemeColors();
  const { startPersonalSignUp } = useAuth();

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
      await startPersonalSignUp(email.trim(), password);
      router.push('/(auth)/verify');
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

          <ScreenTitle>Create your personal account</ScreenTitle>
          <ScreenSubtitle>Just your email and a password — no organization needed.</ScreenSubtitle>

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
          <PrimaryButton title="Create account" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />

          <Pressable
            onPress={() => router.push({ pathname: '/(auth)/signin', params: { mode: 'personal' } })}
            style={{ marginTop: 20, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 14, color: c.textMuted }}>
              Already have a personal account? <Text style={{ color: c.indigo, fontWeight: '700' }}>Sign in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
