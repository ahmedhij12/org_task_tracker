import { useState } from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { FieldInput, UsernameInput, PrimaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';
import { sanitizeOrgCode } from '@/lib/orgCode';

/**
 * Forgot password: a 6-digit code goes to the person's VERIFIED recovery
 * email (see RecoveryEmailCard), and the code sets a new password. The first
 * step never says whether the account exists or has an email — the answer
 * is the same either way — so nobody can use it to find accounts.
 */
export default function ForgotPasswordScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const [step, setStep] = useState<'who' | 'code' | 'done'>('who');
  const [orgCode, setOrgCode] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    if (!orgCode.trim() || !username.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.rpc('request_password_reset', { p_org_code: orgCode.trim(), p_username: username.trim() });
      if (e) throw e;
      setStep('code');
    } catch (e: any) {
      setError(e?.message ?? t('auth.forgot.failed'));
    } finally {
      setBusy(false);
    }
  };

  const mismatch = password2.length > 0 && password !== password2;
  const canReset = code.length === 6 && password.length >= 6 && password === password2;

  const reset = async () => {
    if (!canReset || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc('reset_password_with_code', {
        p_org_code: orgCode.trim(),
        p_username: username.trim(),
        p_code: code,
        p_new_password: password,
      });
      if (e) throw e;
      if (!data) {
        setError(t('auth.forgot.codeWrong'));
        return;
      }
      setStep('done');
    } catch (e: any) {
      setError(e?.message ?? t('auth.forgot.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={{ marginBottom: 20 }} accessibilityRole="button">
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </Pressable>

          <ScreenTitle>{t('auth.forgot.title')}</ScreenTitle>
          <ScreenSubtitle>
            {step === 'who' ? t('auth.forgot.subtitle') : step === 'code' ? t('auth.forgot.codeSubtitle') : t('auth.forgot.doneSubtitle')}
          </ScreenSubtitle>
          <View style={{ height: 20 }} />
          {error ? <ErrorBanner message={error} /> : null}

          {step === 'who' ? (
            <>
              <FieldInput
                label={t('auth.signin.orgIdLabel')}
                placeholder={t('auth.signin.orgIdPlaceholder')}
                value={orgCode}
                onChangeText={(v) => setOrgCode(sanitizeOrgCode(v))}
                keyboardType="number-pad"
              />
              <UsernameInput label={t('common.username')} placeholder={t('common.usernamePlaceholder')} value={username} onChangeText={setUsername} />
              <View style={{ height: 8 }} />
              <PrimaryButton title={t('auth.forgot.sendCode')} onPress={requestCode} loading={busy} disabled={!orgCode.trim() || !username.trim()} />
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 16, lineHeight: 18 }}>{t('auth.forgot.noEmailHint')}</Text>
            </>
          ) : step === 'code' ? (
            <>
              <FieldInput
                label={t('auth.forgot.codeLabel')}
                placeholder="123456"
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
              />
              <FieldInput label={t('auth.forgot.newPassword')} placeholder="••••••" value={password} onChangeText={setPassword} secureTextEntry />
              <FieldInput label={t('auth.forgot.repeatPassword')} placeholder="••••••" value={password2} onChangeText={setPassword2} secureTextEntry />
              {mismatch ? <Text style={{ fontSize: 12, color: c.rose, marginTop: -6, marginBottom: 10 }}>{t('auth.forgot.mismatch')}</Text> : null}
              {password.length > 0 && password.length < 6 ? (
                <Text style={{ fontSize: 12, color: c.textMuted, marginTop: -6, marginBottom: 10 }}>{t('auth.forgot.tooShort')}</Text>
              ) : null}
              <PrimaryButton title={t('auth.forgot.reset')} onPress={reset} loading={busy} disabled={!canReset} />
              <Pressable onPress={requestCode} disabled={busy} style={{ alignItems: 'center', paddingVertical: 14 }}>
                <Text style={{ color: c.textMuted, fontWeight: '600' }}>{t('auth.forgot.sendAgain')}</Text>
              </Pressable>
            </>
          ) : (
            <PrimaryButton title={t('common.signIn')} onPress={() => router.replace('/(auth)/signin')} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
