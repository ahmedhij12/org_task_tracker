import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, UsernameInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';
import { sanitizeOrgCode } from '@/lib/orgCode';

type AccountKind = 'company' | 'personal';

export default function SignInScreen() {
  const c = useThemeColors();
  const { signInWithUsername, signInPersonal } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();

  const [kind, setKind] = useState<AccountKind>(params.mode === 'personal' ? 'personal' : 'company');

  const [orgCode, setOrgCode] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    kind === 'company' ? orgCode.trim() && username.trim() && password.length > 0 : email.trim() && password.length > 0;

  const switchKind = (next: AccountKind) => {
    setKind(next);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (kind === 'company') {
        await signInWithUsername(orgCode.trim(), username.trim(), password);
      } else {
        await signInPersonal(email.trim(), password);
      }
      // Root layout's Stack.Protected guard flips automatically once the session loads.
    } catch (e: any) {
      setError(e?.message ?? 'Could not sign in. Check your details and try again.');
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
          <ScreenSubtitle>
            {kind === 'company'
              ? 'Use the Organization ID and username you set up when you joined.'
              : 'Use the email and password from your personal account.'}
          </ScreenSubtitle>

          <View style={{ height: 20 }} />

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            <Pressable
              onPress={() => switchKind('company')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 999,
                alignItems: 'center',
                backgroundColor: kind === 'company' ? c.indigo : c.bgSubtle,
                borderWidth: 1,
                borderColor: kind === 'company' ? c.indigo : c.border,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: kind === 'company' ? '#fff' : c.text }}>Company</Text>
            </Pressable>
            <Pressable
              onPress={() => switchKind('personal')}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 999,
                alignItems: 'center',
                backgroundColor: kind === 'personal' ? c.indigo : c.bgSubtle,
                borderWidth: 1,
                borderColor: kind === 'personal' ? c.indigo : c.border,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: kind === 'personal' ? '#fff' : c.text }}>Personal</Text>
            </Pressable>
          </View>

          {error ? <ErrorBanner message={error} /> : null}

          {kind === 'company' ? (
            <>
              <FieldInput
                label="Organization ID"
                placeholder="e.g. 48213"
                value={orgCode}
                onChangeText={(t) => setOrgCode(sanitizeOrgCode(t))}
                keyboardType="number-pad"
              />
              <UsernameInput value={username} onChangeText={setUsername} />
              <FieldInput label="Password" placeholder="Your password" value={password} onChangeText={setPassword} secureTextEntry />
            </>
          ) : (
            <>
              <FieldInput
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <FieldInput label="Password" placeholder="Your password" value={password} onChangeText={setPassword} secureTextEntry />
            </>
          )}

          <View style={{ height: 8 }} />
          <PrimaryButton title="Sign in" onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
