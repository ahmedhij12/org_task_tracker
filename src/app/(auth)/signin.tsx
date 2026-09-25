import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, UsernameInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';
import { sanitizeOrgCode } from '@/lib/orgCode';

export default function SignInScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
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
      // Root layout's Stack.Protected guard flips automatically once the session loads.
    } catch (e: any) {
      setError(e?.message ?? t('auth.signin.genericError'));
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

          <ScreenTitle>{t('auth.signin.title')}</ScreenTitle>
          <ScreenSubtitle>{t('auth.signin.subtitle')}</ScreenSubtitle>

          <View style={{ height: 20 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label={t('auth.signin.orgIdLabel')}
            placeholder={t('auth.signin.orgIdPlaceholder')}
            value={orgCode}
            onChangeText={(v) => setOrgCode(sanitizeOrgCode(v))}
            keyboardType="number-pad"
          />
          <UsernameInput
            label={t('common.username')}
            placeholder={t('common.usernamePlaceholder')}
            value={username}
            onChangeText={setUsername}
          />
          <FieldInput
            label={t('auth.signin.passwordLabel')}
            placeholder={t('auth.signin.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <View style={{ height: 8 }} />
          <PrimaryButton title={t('common.signIn')} onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
          <Pressable onPress={() => router.push('/(auth)/forgot')} style={{ alignItems: 'center', paddingVertical: 16 }} accessibilityRole="button">
            <Text style={{ color: c.brand, fontWeight: '700', fontSize: 14 }}>{t('auth.signin.forgot')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
