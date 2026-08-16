import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useThemePref } from '@/hooks/useThemePref';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { ThemePref } from '@/types';

export default function SettingsScreen() {
  const c = useThemeColors();
  const { profile, organization, team, signOut, addRecoveryEmail } = useAuth();
  const { themePref, setThemePref } = useThemePref();
  const [copied, setCopied] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState(profile?.recoveryEmail ?? '');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const roleLabel = profile?.role === 'owner' ? 'Owner' : profile?.role === 'team_admin' ? 'Team Admin' : 'Employee';

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

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
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
                {team ? ` • ${team.name}` : ''}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Organization</Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{organization?.name}</Text>
          {profile?.role === 'owner' ? (
            <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Text style={{ fontSize: 13, color: c.textMuted }}>ID: {organization?.orgCode}</Text>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={c.textMuted} />
            </Pressable>
          ) : null}
        </Card>

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

        <Pressable
          onPress={handleSignOut}
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

        <Text style={{ fontSize: 11, color: c.textFaint, textAlign: 'center', marginTop: 24 }}>OrgTasks • v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
