import { useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { FieldInput, UsernameInput, PrimaryButton, SecondaryButton, ErrorBanner, ScreenTitle, ScreenSubtitle, useThemeColors } from '@/components/ui';

interface TeamOption {
  teamId: string;
  teamName: string;
  orgId: string;
  orgName: string;
  adminName: string | null;
}

export default function JoinOrgScreen() {
  const c = useThemeColors();
  const { lookupOrgByCode, joinOrganization } = useAuth();

  const [step, setStep] = useState<'code' | 'details'>('code');
  const [orgCode, setOrgCode] = useState('');
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async () => {
    if (!orgCode.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const teams = await lookupOrgByCode(orgCode.trim());
      if (teams.length === 0) {
        setError('No organization found with that ID, or it has no teams yet.');
        return;
      }
      setTeamOptions(teams);
      setSelectedTeamId(teams[0].teamId);
      setStep('details');
    } catch (e: any) {
      setError(e?.message ?? 'Could not look up that organization.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = selectedTeamId && name.trim() && username.trim() && email.trim() && password.length >= 6;

  const handleJoin = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await joinOrganization({
        orgCode: orgCode.trim(),
        teamId: selectedTeamId!,
        name: name.trim(),
        title: title.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
      });
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => (step === 'details' ? setStep('code') : router.back())}
            style={{ marginBottom: 20 }}
          >
            <Ionicons name="arrow-back" size={24} color={c.text} />
          </Pressable>

          {step === 'code' ? (
            <>
              <ScreenTitle>Join an organization</ScreenTitle>
              <ScreenSubtitle>Enter the Organization ID your admin shared with you.</ScreenSubtitle>
              <View style={{ height: 24 }} />
              {error ? <ErrorBanner message={error} /> : null}
              <FieldInput
                label="Organization ID"
                placeholder="e.g. ACME482"
                value={orgCode}
                onChangeText={setOrgCode}
                autoCapitalize="characters"
              />
              <View style={{ height: 8 }} />
              <PrimaryButton title="Continue" onPress={handleLookup} loading={loading} disabled={!orgCode.trim()} />
            </>
          ) : (
            <>
              <ScreenTitle>Choose your team leader</ScreenTitle>
              <ScreenSubtitle>{teamOptions[0]?.orgName} has {teamOptions.length} team{teamOptions.length === 1 ? '' : 's'}. Pick the one you report to.</ScreenSubtitle>
              <View style={{ height: 20 }} />
              {error ? <ErrorBanner message={error} /> : null}

              <View style={{ gap: 8, marginBottom: 18 }}>
                {teamOptions.map((t) => (
                  <Pressable
                    key={t.teamId}
                    onPress={() => setSelectedTeamId(t.teamId)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderWidth: selectedTeamId === t.teamId ? 2 : 1,
                      borderColor: selectedTeamId === t.teamId ? c.indigo : c.border,
                      borderRadius: 14,
                      padding: 14,
                      backgroundColor: c.card,
                    }}
                  >
                    <View>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{t.teamName}</Text>
                      <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                        {t.adminName ? `Led by ${t.adminName}` : 'No team leader assigned yet'}
                      </Text>
                    </View>
                    {selectedTeamId === t.teamId ? <Ionicons name="checkmark-circle" size={20} color={c.indigo} /> : null}
                  </Pressable>
                ))}
              </View>

              <FieldInput label="Your name" placeholder="e.g. Ali" value={name} onChangeText={setName} />
              <FieldInput label="Your role" placeholder="e.g. IT, Accountant, Cashier" value={title} onChangeText={setTitle} />
              <UsernameInput value={username} onChangeText={setUsername} />
              <FieldInput
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <FieldInput label="Password" placeholder="At least 6 characters" value={password} onChangeText={setPassword} secureTextEntry />

              <View style={{ height: 8 }} />
              <PrimaryButton title="Join organization" onPress={handleJoin} loading={loading} disabled={!canSubmit} />
              <View style={{ height: 10 }} />
              <SecondaryButton title="Back" onPress={() => setStep('code')} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
