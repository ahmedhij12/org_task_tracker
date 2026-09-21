import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useThemePref } from '@/hooks/useThemePref';
import { useLanguagePref, type LanguagePref } from '@/hooks/useLanguagePref';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { ThemePref } from '@/types';

export default function SettingsScreen() {
  const c = useThemeColors();
  const { profile, organization, teams, signOut, addRecoveryEmail, setIqdPerPoint } = useAuth();
  const { themePref, setThemePref } = useThemePref();
  const { languagePref, setLanguagePref, needsRestartForDirection } = useLanguagePref();
  const [copied, setCopied] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState(profile?.recoveryEmail ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [rateText, setRateText] = useState(String(organization?.iqdPerPoint ?? ''));
  const [savingRate, setSavingRate] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  // In-app rather than Alert.alert: react-native-web does not implement Alert
  // with buttons, so the callback never fires and sign-out silently did nothing.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const roleLabel = profile?.role === 'owner' ? 'Admin' : profile?.role === 'team_admin' ? 'Branch manager' : 'Supervisor';

  const handleCopy = async () => {
    if (!organization) return;
    await Clipboard.setStringAsync(organization.orgCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveEmail = async () => {
    const trimmed = recoveryEmail.trim();
    if (!trimmed || savingEmail) return;
    setSavingEmail(true);
    setEmailNotice(null);
    setEmailError(null);
    try {
      await addRecoveryEmail(trimmed);
      setEmailNotice('Saved. You can use this address to reset your password if you forget it.');
    } catch (e: any) {
      setEmailError(e?.message ?? 'Could not save that email. Please try again.');
    } finally {
      setSavingEmail(false);
    }
  };

  const parsedRate = Number(rateText.replace(/,/g, '').trim());
  const rateValid = rateText.trim() !== '' && Number.isFinite(parsedRate) && parsedRate > 0;

  const handleSaveRate = async () => {
    if (!rateValid || savingRate) return;
    setSavingRate(true);
    setRateNotice(null);
    setRateError(null);
    try {
      await setIqdPerPoint(parsedRate);
      setRateText(String(parsedRate));
      setRateNotice(`Saved. Audits from now on use 1 point = ${parsedRate.toLocaleString()} IQD.`);
    } catch (e: any) {
      setRateError(e?.message ?? 'Could not save the rate. Please try again.');
    } finally {
      setSavingRate(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 20 }}>Settings</Text>

        <Card style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.indigo, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{profile?.name?.[0]?.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: c.text }}>{profile?.name}</Text>
              <Text style={{ fontSize: 12, color: c.textMuted }}>
                {profile?.username ? `@${profile.username} • ` : ''}
                {profile?.title && profile.title.toLowerCase() !== roleLabel.toLowerCase() ? `${profile.title} • ` : ''}
                {roleLabel}
                {teams.length > 0 ? ` • ${teams.map((t) => t.name).join(', ')}` : ''}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Organization</Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{organization?.name}</Text>
          <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Text style={{ fontSize: 13, color: c.textMuted }}>ID: {organization?.orgCode}</Text>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={c.textMuted} />
          </Pressable>
        </Card>

        {profile?.role === 'owner' ? (
          <Card style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
              Point value
            </Text>
            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>
              How much 1 penalty point is worth. Currently 1 point = {(organization?.iqdPerPoint ?? 0).toLocaleString()} IQD.
              A change applies to new audits only — past audits and closed months keep the value they were scored at.
            </Text>
            {rateError ? <ErrorBanner message={rateError} /> : null}
            {rateNotice ? (
              <View style={{ backgroundColor: c.indigoSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                <Text style={{ color: c.indigo, fontSize: 13 }}>{rateNotice}</Text>
              </View>
            ) : null}
            <FieldInput
              placeholder="25000"
              value={rateText}
              onChangeText={(v) => {
                setRateText(v);
                setRateNotice(null);
              }}
              keyboardType="number-pad"
            />
            <PrimaryButton
              title="Save point value"
              onPress={handleSaveRate}
              loading={savingRate}
              disabled={!rateValid || parsedRate === organization?.iqdPerPoint}
            />
          </Card>
        ) : null}

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>
            Recovery email
          </Text>
          <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>
            Optional. Without one, only your admin can reset your password for you.
          </Text>
          {emailError ? <ErrorBanner message={emailError} /> : null}
          {emailNotice ? (
            <View style={{ backgroundColor: c.indigoSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <Text style={{ color: c.indigo, fontSize: 13 }}>{emailNotice}</Text>
            </View>
          ) : null}
          <FieldInput
            placeholder="you@example.com"
            value={recoveryEmail}
            onChangeText={setRecoveryEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <PrimaryButton
            title="Save recovery email"
            onPress={handleSaveEmail}
            loading={savingEmail}
            disabled={!recoveryEmail.trim() || recoveryEmail.trim() === (profile?.recoveryEmail ?? '')}
          />
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>Appearance</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                { key: 'light', label: 'Light', icon: 'sunny' },
                { key: 'dark', label: 'Dark', icon: 'moon' },
                { key: 'auto', label: 'Auto', icon: 'phone-portrait' },
              ] as { key: ThemePref; label: string; icon: keyof typeof Ionicons.glyphMap }[]
            ).map((opt) => {
              const active = themePref === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setThemePref(opt.key)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: active ? c.indigo : c.bgSubtle,
                    borderWidth: 1,
                    borderColor: active ? c.indigo : c.border,
                  }}
                >
                  <Ionicons name={opt.icon} size={18} color={active ? '#fff' : c.textMuted} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : c.text, marginTop: 4 }}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>Language</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                { key: 'en', label: 'English' },
                { key: 'ar', label: 'العربية' },
                { key: 'auto', label: 'Auto' },
              ] as { key: LanguagePref; label: string }[]
            ).map((opt) => {
              const active = languagePref === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setLanguagePref(opt.key)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: active ? c.indigo : c.bgSubtle,
                    borderWidth: 1,
                    borderColor: active ? c.indigo : c.border,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {needsRestartForDirection ? (
            <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 10 }}>
              Text updates right away. Fully close and reopen the app for right-to-left layout to match.
            </Text>
          ) : null}
        </Card>

        {confirmingSignOut ? (
          <View style={{ borderWidth: 1, borderColor: c.roseSoft, backgroundColor: c.roseSoft, borderRadius: 14, padding: 14 }}>
            <Text style={{ color: c.rose, fontSize: 13, marginBottom: 12 }}>
              Sign out of {organization?.name ?? 'this organization'}? You'll need your Organization ID, username, and
              password to get back in.
            </Text>
            <Pressable
              onPress={() => signOut()}
              style={{ alignItems: 'center', backgroundColor: c.rose, borderRadius: 12, paddingVertical: 12 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Yes, sign out</Text>
            </Pressable>
            <View style={{ height: 8 }} />
            <Pressable onPress={() => setConfirmingSignOut(false)} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: c.rose, fontWeight: '600', fontSize: 14 }}>Stay signed in</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setConfirmingSignOut(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderWidth: 1,
              borderColor: c.roseSoft,
              backgroundColor: c.roseSoft,
              borderRadius: 14,
              paddingVertical: 14,
            }}
          >
            <Ionicons name="log-out-outline" size={18} color={c.rose} />
            <Text style={{ color: c.rose, fontWeight: '700', fontSize: 15 }}>Sign out</Text>
          </Pressable>
        )}

        <Text style={{ fontSize: 11, color: c.textFaint, textAlign: 'center', marginTop: 24 }}>Rungs • v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
