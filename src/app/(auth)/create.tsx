import { useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, UsernameInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function CreateOrgScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { startOrganizationSignUp } = useAuth();
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
      await startOrganizationSignUp({
        orgName: orgName.trim(),
        ownerName: ownerName.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
      });
      // The organization is created on the far side of the emailed code.
      router.push('/(auth)/verify');
    } catch (e: any) {
      setError(e?.message ?? t('auth.create.genericError'));
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

          <ScreenTitle>{t('auth.create.title')}</ScreenTitle>
          <ScreenSubtitle>{t('auth.create.subtitle')}</ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label={t('auth.create.orgNameLabel')}
            placeholder={t('auth.create.orgNamePlaceholder')}
            value={orgName}
            onChangeText={setOrgName}
          />
          <FieldInput
            label={t('auth.create.yourNameLabel')}
            placeholder={t('auth.create.yourNamePlaceholder')}
            value={ownerName}
            onChangeText={setOwnerName}
          />
          <UsernameInput
            label={t('common.username')}
            placeholder={t('common.usernamePlaceholder')}
            value={username}
            onChangeText={setUsername}
          />
          <Text style={{ fontSize: 11, color: c.textFaint, marginTop: -8, marginBottom: 14 }}>{t('auth.create.usernameHint')}</Text>
          <FieldInput
            label={t('auth.create.emailLabel')}
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <FieldInput
            label={t('auth.create.passwordLabel')}
            placeholder={t('auth.create.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <View style={{ height: 8 }} />
          <PrimaryButton title={t('auth.create.submit')} onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
