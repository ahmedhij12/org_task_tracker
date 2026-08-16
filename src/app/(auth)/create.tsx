import { useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, UsernameInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function CreateOrgScreen() {
  const c = useThemeColors();
  const { createOrganization } = useAuth();
  const [orgName, setOrgName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = orgName.trim() && ownerName.trim() && username.trim() && email.trim() && password.length >= 6;

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await createOrganization({
        orgName: orgName.trim(),
        ownerName: ownerName.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
      });
      // Root layout's Stack.Protected guard flips automatically once profile loads.
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

          <ScreenTitle>Create your organization</ScreenTitle>
          <ScreenSubtitle>
            You'll get a unique Organization ID to share with your team so they can join.
          </ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput label="Organization name" placeholder="e.g. Basra Retail Co." value={orgName} onChangeText={setOrgName} />
          <FieldInput label="Your name" placeholder="e.g. Ahmed" value={ownerName} onChangeText={setOwnerName} />
          <UsernameInput value={username} onChangeText={setUsername} />
          <Text style={{ fontSize: 11, color: c.textFaint, marginTop: -8, marginBottom: 14 }}>
            You'll use this (with your Organization ID) to sign in next time — no need to retype your email.
          </Text>
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
          <PrimaryButton title="Create organization" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
