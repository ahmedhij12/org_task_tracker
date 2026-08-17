import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { generatePassword } from '@/lib/password';
import {
  Card,
  FieldInput,
  FieldLabel,
  UsernameInput,
  PrimaryButton,
  SecondaryButton,
  ErrorBanner,
  useThemeColors,
} from '@/components/ui';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CreateUserSheet({ visible, onClose }: Props) {
  const c = useThemeColors();
  const { profile, adminCreateUser } = useAuth();
  const { teams, refresh } = useOrgData();

  const isOwner = profile?.role === 'owner';

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [role, setRole] = useState<'employee' | 'team_admin'>('employee');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the account exists — the only time the password is ever shown.
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // A team leader can only ever create employees on their own team, so lock
  // those two fields to their own values whenever the sheet opens.
  useEffect(() => {
    if (!visible) return;
    if (!isOwner) {
      setRole('employee');
      setTeamId(profile?.teamIds[0] ?? null);
    }
  }, [visible, isOwner, profile?.teamIds]);

  const reset = () => {
    setName('');
    setTitle('');
    setUsername('');
    setPassword(generatePassword());
    setRole('employee');
    setTeamId(isOwner ? null : (profile?.teamIds[0] ?? null));
    setError(null);
    setCreated(null);
    setCopied(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const canSubmit = name.trim().length > 0 && username.trim().length > 0 && password.length >= 6;

  const handleCreate = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await adminCreateUser({ name, username, password, role, teamId, title });
      setCreated({ username: username.trim(), password });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not create this account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    await Clipboard.setStringAsync(`Username: ${created.username}\nPassword: ${created.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: c.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 32,
              maxHeight: '90%',
            }}
          >
            {created ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 4 }}>Account created</Text>
                <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 16 }}>
                  Write these down or copy them now — the password is not shown again. They will be asked to choose
                  their own password the first time they sign in.
                </Text>

                <Card style={{ marginBottom: 14 }}>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>Username</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 10 }}>
                    {created.username}
                  </Text>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>Temporary password</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: c.text }}>{created.password}</Text>
                </Card>

                <Pressable
                  onPress={handleCopy}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 14,
                    paddingVertical: 14,
                    marginBottom: 10,
                  }}
                >
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={18} color={c.text} />
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>
                    {copied ? 'Copied' : 'Copy username and password'}
                  </Text>
                </Pressable>

                <PrimaryButton title="Done" onPress={handleClose} />
              </ScrollView>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled">
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <Text style={{ fontSize: 17, fontWeight: '700', color: c.text }}>New person</Text>
                  <Pressable onPress={handleClose} hitSlop={8}>
                    <Ionicons name="close" size={24} color={c.textMuted} />
                  </Pressable>
                </View>

                {error ? <ErrorBanner message={error} /> : null}

                <FieldInput label="Their name" placeholder="e.g. Ali" value={name} onChangeText={setName} />
                <FieldInput
                  label="Job title (optional)"
                  placeholder="e.g. IT, Accountant, Cashier"
                  value={title}
                  onChangeText={setTitle}
                />
                <UsernameInput value={username} onChangeText={setUsername} />

                <FieldLabel>Temporary password</FieldLabel>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <FieldInput
                      placeholder="At least 6 characters"
                      value={password}
                      onChangeText={setPassword}
                      autoCapitalize="none"
                    />
                  </View>
                  <Pressable
                    onPress={() => setPassword(generatePassword())}
                    style={{
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 14,
                      paddingHorizontal: 14,
                      paddingVertical: 13,
                      backgroundColor: c.card,
                    }}
                  >
                    <Ionicons name="refresh" size={18} color={c.text} />
                  </Pressable>
                </View>

                {isOwner ? (
                  <>
                    <FieldLabel>Role</FieldLabel>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                      {(
                        [
                          { key: 'employee', label: 'Employee' },
                          { key: 'team_admin', label: 'Team leader' },
                        ] as { key: 'employee' | 'team_admin'; label: string }[]
                      ).map((opt) => {
                        const active = role === opt.key;
                        return (
                          <Pressable
                            key={opt.key}
                            onPress={() => setRole(opt.key)}
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
                            <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <FieldLabel>Team</FieldLabel>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                      <Pressable
                        onPress={() => setTeamId(null)}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 999,
                          backgroundColor: teamId === null ? c.indigo : c.bgSubtle,
                          borderWidth: 1,
                          borderColor: teamId === null ? c.indigo : c.border,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: teamId === null ? '#fff' : c.text }}>
                          No team
                        </Text>
                      </Pressable>
                      {teams.map((t) => {
                        const active = teamId === t.id;
                        return (
                          <Pressable
                            key={t.id}
                            onPress={() => setTeamId(t.id)}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              backgroundColor: active ? c.indigo : c.bgSubtle,
                              borderWidth: 1,
                              borderColor: active ? c.indigo : c.border,
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>
                              {t.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
                    They will join your team as an employee.
                  </Text>
                )}

                <PrimaryButton title="Create account" onPress={handleCreate} loading={loading} disabled={!canSubmit} />
                <View style={{ height: 10 }} />
                <SecondaryButton title="Cancel" onPress={handleClose} />
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
