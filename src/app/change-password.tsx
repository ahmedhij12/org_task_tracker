import { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

export default function ChangePasswordScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
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
      setError(e?.message ?? t('changePassword.genericError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
          <ScreenTitle>{t('changePassword.title')}</ScreenTitle>
          <ScreenSubtitle>
            {profile?.name ? t('changePassword.welcomeSubtitle', { name: profile.name }) : t('changePassword.subtitle')}
          </ScreenSubtitle>

          <View style={{ height: 24 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <FieldInput
            label={t('changePassword.newPasswordLabel')}
            placeholder={t('changePassword.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {tooShort ? (
            <Text style={{ fontSize: 12, color: c.rose, marginTop: -8, marginBottom: 10 }}>{t('changePassword.tooShort')}</Text>
          ) : null}

          <FieldInput
            label={t('changePassword.confirmLabel')}
            placeholder={t('changePassword.confirmPlaceholder')}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
          />
          {mismatch ? (
            <Text style={{ fontSize: 12, color: c.rose, marginTop: -8, marginBottom: 10 }}>{t('changePassword.mismatch')}</Text>
          ) : null}

          <View style={{ height: 8 }} />
          <PrimaryButton title={t('changePassword.submit')} onPress={handleSubmit} loading={loading} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
