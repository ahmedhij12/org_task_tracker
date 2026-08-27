import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, SIGNUP_CODE_LENGTH } from '@/hooks/useAuth';
import { ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';
import { OtpDial } from '@/components/OtpDial';

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyCodeScreen() {
  const c = useThemeColors();
  const { pendingSignUp, verifySignUpCode, resendSignUpCode, cancelSignUp } = useAuth();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  // A reload drops the in-memory sign-up, so there is nothing left to verify.
  // Success also clears it, and that case must NOT bounce back to the start —
  // the root layout's guard is already swapping to (main)/(personal).
  useEffect(() => {
    if (!pendingSignUp && !succeeded) router.replace('/(auth)');
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
    try {
      await verifySignUpCode(value);
      setSucceeded(true);
      // The root layout's Stack.Protected guard takes over once the profile loads.
    } catch (e: any) {
      setErrored(true);
      setCode('');
      setError(e?.message ?? 'That code did not work. Please try again.');
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
      setNotice('We sent a new code.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not send another code. Please wait a minute and try again.');
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

          <ScreenTitle>Check your email</ScreenTitle>
          <ScreenSubtitle>
            We sent a {SIGNUP_CODE_LENGTH}-digit code to {pendingSignUp?.email ?? 'your inbox'}. Enter it below to finish
            setting up your account.
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
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Send a new code'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
