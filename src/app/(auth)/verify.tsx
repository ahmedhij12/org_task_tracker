import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth, SIGNUP_CODE_LENGTH } from '@/hooks/useAuth';
import { ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';
import { OtpDial } from '@/components/OtpDial';

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyCodeScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { pendingSignUp, verifySignUpCode, resendSignUpCode, cancelSignUp } = useAuth();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // A reload drops the in-memory sign-up, so there is nothing left to verify.
  // verifySignUpCode clears pendingSignUp partway through itself — before
  // refreshProfile() has finished loading the new session — so there is a
  // real gap where pendingSignUp is already null but the local `succeeded`
  // state (set only once the whole call resolves) has not caught up yet.
  // Without this ref, that gap fires this effect and bounces a successful
  // sign-up straight back to the start screen. The ref is set synchronously
  // the instant verification begins, closing the gap.
  const verifyingRef = useRef(false);
  useEffect(() => {
    if (!pendingSignUp && !succeeded && !verifyingRef.current) router.replace('/(auth)');
  }, [pendingSignUp, succeeded]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleChange = (next: string) => {
    setCode(next);
    setErrored(false);
  };

  const submit = async (value: string) => {
    if (value.length !== SIGNUP_CODE_LENGTH || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    verifyingRef.current = true;
    try {
      await verifySignUpCode(value);
      setSucceeded(true);
      // The root layout's Stack.Protected guard takes over once the profile loads.
    } catch (e: any) {
      verifyingRef.current = false;
      setErrored(true);
      setCode('');
      setError(e?.message ?? t('auth.verify.genericError'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || loading) return;
    setError(null);
    try {
      await resendSignUpCode();
      setCode('');
      setErrored(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setNotice(t('auth.verify.resendNotice'));
    } catch (e: any) {
      setError(e?.message ?? t('auth.verify.resendError'));
    }
  };

  const handleBack = () => {
    cancelSignUp();
    router.back();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={handleBack} style={{ marginBottom: 20 }}>
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </Pressable>

          <ScreenTitle>{t('auth.verify.title')}</ScreenTitle>
          <ScreenSubtitle>
            {t('auth.verify.subtitle', {
              length: SIGNUP_CODE_LENGTH,
              email: pendingSignUp?.email ?? t('auth.verify.defaultInbox'),
            })}
          </ScreenSubtitle>

          <View style={{ height: 32 }} />

          {error ? <ErrorBanner message={error} /> : null}

          <View style={{ height: 8 }} />

          <OtpDial
            length={SIGNUP_CODE_LENGTH}
            value={code}
            onChange={handleChange}
            onComplete={submit}
            errored={errored}
            succeeded={succeeded}
            disabled={loading}
          />

          {notice ? (
            <Text style={{ fontSize: 13, color: c.textMuted, textAlign: 'center', marginTop: 24 }}>{notice}</Text>
          ) : null}

          <Pressable onPress={handleResend} disabled={cooldown > 0} style={{ marginTop: 24, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, color: cooldown > 0 ? c.textFaint : c.indigo, fontWeight: '700' }}>
              {cooldown > 0 ? t('auth.verify.resendCooldown', { seconds: cooldown }) : t('auth.verify.resendNow')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
