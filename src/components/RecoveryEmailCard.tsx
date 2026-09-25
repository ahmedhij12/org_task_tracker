import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';

/**
 * The recovery email, proved before it counts: type the address, a 6-digit
 * code is mailed to it, type the code. Only a verified address can receive a
 * "forgot password" code. The sign-in address itself never changes.
 */
export function RecoveryEmailCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile, requestRecoveryEmail, confirmRecoveryEmail } = useAuth();
  const verified = !!profile?.recoveryEmail && !!profile?.recoveryEmailVerifiedAt;

  const [editing, setEditing] = useState(!verified);
  const [email, setEmail] = useState(verified ? '' : (profile?.recoveryEmail ?? ''));
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const trimmed = email.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestRecoveryEmail(trimmed);
      setSentTo(trimmed.toLowerCase());
      setCode('');
      setNotice(t('settings.codeSent', { email: trimmed.toLowerCase() }));
    } catch (e: any) {
      setError(e?.message ?? t('settings.emailFailed'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (code.trim().length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await confirmRecoveryEmail(code);
      if (!ok) {
        setError(t('settings.codeWrong'));
        return;
      }
      setSentTo(null);
      setEditing(false);
      setNotice(t('settings.emailVerified'));
    } catch (e: any) {
      setError(e?.message ?? t('settings.emailFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
        {t('settings.recoveryEmail')}
      </Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>{t('settings.recoveryHint')}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? (
        <View style={{ backgroundColor: c.brandSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Text style={{ color: c.brand, fontSize: 13 }}>{notice}</Text>
        </View>
      ) : null}

      {!editing && verified ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="checkmark-circle" size={20} color={c.emerald} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{profile?.recoveryEmail}</Text>
            <Text style={{ fontSize: 12, color: c.emerald }}>{t('settings.verified')}</Text>
          </View>
          <Pressable onPress={() => { setEditing(true); setNotice(null); }} hitSlop={8}>
            <Text style={{ color: c.brand, fontWeight: '700' }}>{t('settings.change')}</Text>
          </Pressable>
        </View>
      ) : sentTo ? (
        <>
          <FieldInput
            label={t('settings.codeLabel')}
            placeholder="123456"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            testID="recovery-code"
          />
          <PrimaryButton title={t('settings.confirmCode')} onPress={confirm} loading={busy} disabled={code.length !== 6} />
          <Pressable onPress={send} disabled={busy} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ color: c.textMuted, fontWeight: '600' }}>{t('settings.sendAgain')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          {profile?.recoveryEmail && !verified ? (
            <Text style={{ fontSize: 12, color: c.amber, marginBottom: 8 }}>{t('settings.notVerified', { email: profile.recoveryEmail })}</Text>
          ) : null}
          <FieldInput placeholder="you@example.com" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" testID="recovery-email" />
          <PrimaryButton title={t('settings.sendCode')} onPress={send} loading={busy} disabled={!email.trim()} />
          {verified ? (
            <Pressable onPress={() => setEditing(false)} style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ color: c.textMuted, fontWeight: '600' }}>{t('settings.cancel')}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </Card>
  );
}
