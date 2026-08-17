import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { useOrgData } from '@/hooks/useOrgData';
import { generatePassword } from '@/lib/password';
import { FieldInput, FieldLabel, PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { Profile } from '@/types';

interface Props {
  member: Profile | null;
  onClose: () => void;
}

export function ManageUserSheet({ member, onClose }: Props) {
  const c = useThemeColors();
  const { profile, adminResetPassword, adminSetUserActive } = useAuth();
  const { refresh } = useOrgData();

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Deliberately an in-app confirmation rather than Alert.alert: react-native-web
  // does not implement Alert with buttons, so on web the callback never fires and
  // the deactivation silently does nothing.
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  useEffect(() => {
    setPassword('');
    setError(null);
    setNotice(null);
    setConfirmingDeactivate(false);
  }, [member?.id]);

  if (!member) return null;

  // The owner is never deactivatable, and nobody can deactivate themselves.
  const canDeactivate = member.role !== 'owner' && member.id !== profile?.id;

  const handleReset = async () => {
    if (password.length < 6 || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await adminResetPassword(member.id, password);
      await refresh();
      setNotice(`Password updated. Give ${member.name} the new password — they will be asked to choose their own.`);
      setPassword('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not reset that password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const applyActive = async (next: boolean) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await adminSetUserActive(member.id, next);
      await refresh();
      setConfirmingDeactivate(false);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not update that account. Please try again.');
      setConfirmingDeactivate(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
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
            <ScrollView keyboardShouldPersistTaps="handled">
              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}
              >
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{member.name}</Text>
                <Pressable onPress={onClose} hitSlop={8}>
                  <Ionicons name="close" size={24} color={c.textMuted} />
                </Pressable>
              </View>
              <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 18 }}>
                {member.username ? `@${member.username}` : 'No username'}
                {member.active ? '' : ' • inactive'}
              </Text>

              {error ? <ErrorBanner message={error} /> : null}
              {notice ? (
                <View style={{ backgroundColor: c.indigoSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <Text style={{ color: c.indigo, fontSize: 13 }}>{notice}</Text>
                </View>
              ) : null}

              <FieldLabel>Set new password</FieldLabel>
              <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 8 }}>
                Use this when they forget their password. You do not need their old one.
              </Text>
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

              <PrimaryButton
                title="Set new password"
                onPress={handleReset}
                loading={loading}
                disabled={password.length < 6}
              />

              {canDeactivate ? (
                <>
                  <View style={{ height: 20 }} />
                  {confirmingDeactivate ? (
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: c.roseSoft,
                        backgroundColor: c.roseSoft,
                        borderRadius: 14,
                        padding: 14,
                      }}
                    >
                      <Text style={{ color: c.rose, fontSize: 13, marginBottom: 12 }}>
                        {member.name} will be signed out and will not be able to sign in again until you reactivate
                        them.
                      </Text>
                      <Pressable
                        onPress={() => applyActive(false)}
                        disabled={loading}
                        style={{
                          alignItems: 'center',
                          backgroundColor: c.rose,
                          borderRadius: 12,
                          paddingVertical: 12,
                          opacity: loading ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Yes, deactivate</Text>
                      </Pressable>
                      <View style={{ height: 8 }} />
                      <Pressable
                        onPress={() => setConfirmingDeactivate(false)}
                        disabled={loading}
                        style={{ alignItems: 'center', paddingVertical: 10 }}
                      >
                        <Text style={{ color: c.rose, fontWeight: '600', fontSize: 14 }}>Keep active</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => (member.active ? setConfirmingDeactivate(true) : applyActive(true))}
                      disabled={loading}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        borderWidth: 1,
                        borderColor: member.active ? c.roseSoft : c.border,
                        backgroundColor: member.active ? c.roseSoft : 'transparent',
                        borderRadius: 14,
                        paddingVertical: 14,
                        opacity: loading ? 0.5 : 1,
                      }}
                    >
                      <Ionicons
                        name={member.active ? 'ban-outline' : 'checkmark-circle-outline'}
                        size={18}
                        color={member.active ? c.rose : c.text}
                      />
                      <Text style={{ color: member.active ? c.rose : c.text, fontWeight: '700', fontSize: 15 }}>
                        {member.active ? 'Deactivate account' : 'Reactivate account'}
                      </Text>
                    </Pressable>
                  )}
                </>
              ) : null}

              <View style={{ height: 10 }} />
              <SecondaryButton title="Close" onPress={onClose} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
