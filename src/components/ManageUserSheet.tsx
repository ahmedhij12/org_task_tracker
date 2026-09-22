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
  const { profile, adminResetPassword, adminSetUserActive, adminDeleteUser, addProfileToTeam, removeProfileFromTeam } = useAuth();
  const { members, teams, brands, branchBrandIds, refresh } = useOrgData();

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Deliberately an in-app confirmation rather than Alert.alert: react-native-web
  // does not implement Alert with buttons, so on web the callback never fires and
  // the deactivation silently does nothing.
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [brandBusyTeamId, setBrandBusyTeamId] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setError(null);
    setNotice(null);
    setConfirmingDeactivate(false);
    setConfirmingDelete(false);
  }, [member?.id]);

  if (!member) return null;

  // Re-read from the live list so adding/removing a team updates the chips
  // immediately, instead of showing the snapshot from when the sheet opened.
  const live = members.find((m) => m.id === member.id) ?? member;

  // The owner is never deactivatable, and nobody can deactivate themselves.
  const canDeactivate = live.role !== 'owner' && live.id !== profile?.id;
  const isOwner = profile?.role === 'owner';
  const memberTeams = teams.filter((t) => live.teamIds.includes(t.id));
  // An owner can add anyone (branch manager or supervisor) to any branch; a
  // branch manager can only add a supervisor, and only to their own branch.
  const addableTeams =
    live.role === 'owner'
      ? []
      : teams.filter((t) => {
          if (live.teamIds.includes(t.id)) return false;
          if (isOwner) return true;
          return live.role === 'employee' && !!profile?.teamIds.includes(t.id);
        });

  const handleAddTeam = async (teamId: string) => {
    setTeamBusy(teamId);
    setError(null);
    try {
      await addProfileToTeam(live.id, teamId);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not add that branch.');
    } finally {
      setTeamBusy(null);
    }
  };

  const handleRemoveTeam = async (teamId: string) => {
    setTeamBusy(teamId);
    setError(null);
    try {
      await removeProfileFromTeam(live.id, teamId);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Could not remove that branch.');
    } finally {
      setTeamBusy(null);
    }
  };

  const handleReset = async () => {
    if (password.length < 6 || loading) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await adminResetPassword(live.id, password);
      await refresh();
      setNotice(`Password updated. Give ${live.name} the new password — they will be asked to choose their own.`);
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
      await adminSetUserActive(live.id, next);
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

  const applyDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      await adminDeleteUser(live.id);
      await refresh();
      setConfirmingDelete(false);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not delete that account. Please try again.');
      setConfirmingDelete(false);
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
                <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, flex: 1 }}>{live.name}</Text>
                <Pressable onPress={onClose} hitSlop={8}>
                  <Ionicons name="close" size={24} color={c.textMuted} />
                </Pressable>
              </View>
              <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 18 }}>
                {live.username ? `@${live.username}` : 'No username'}
                {live.employeeCode ? ` • Company ID ${live.employeeCode}` : ''}
                {live.active ? '' : ' • inactive'}
              </Text>

              {isOwner ? (
                <>
              {error ? <ErrorBanner message={error} /> : null}
              {notice ? (
                <View style={{ backgroundColor: c.brandSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <Text style={{ color: c.brand, fontSize: 13 }}>{notice}</Text>
                </View>
              ) : null}

              {live.role !== 'owner' ? (
                <View style={{ marginBottom: 18 }}>
                  <FieldLabel>Branches</FieldLabel>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: memberTeams.length > 0 ? 10 : 0 }}>
                    {memberTeams.map((t) => (
                      <View
                        key={t.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          backgroundColor: c.brandSoft,
                          borderRadius: 999,
                          paddingLeft: 12,
                          paddingRight: 8,
                          paddingVertical: 6,
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '600', color: c.brand }}>{t.name}</Text>
                        <Pressable onPress={() => handleRemoveTeam(t.id)} disabled={teamBusy === t.id} hitSlop={6}>
                          <Ionicons name="close" size={13} color={c.brand} />
                        </Pressable>
                      </View>
                    ))}
                    {memberTeams.length === 0 ? (
                      <Text style={{ fontSize: 12, color: c.textFaint }}>No branch — working unattached.</Text>
                    ) : null}
                  </View>

                  {live.role === 'employee'
                    ? memberTeams.map((t) => {
                        const available = branchBrandIds[t.id] ?? [];
                        if (available.length === 0) return null;
                        return (
                          <View key={`brand-${t.id}`} style={{ marginTop: 6 }}>
                            <Text style={{ fontSize: 11, color: c.textFaint, marginBottom: 4 }}>{t.name} brand</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {available.map((bid) => {
                                const brand = brands.find((b) => b.id === bid);
                                if (!brand) return null;
                                const active = live.teamBrandIds[t.id] === bid;
                                return (
                                  <Pressable
                                    key={bid}
                                    disabled={brandBusyTeamId === t.id}
                                    onPress={async () => {
                                      setBrandBusyTeamId(t.id);
                                      setError(null);
                                      try {
                                        await addProfileToTeam(live.id, t.id, active ? null : bid);
                                        await refresh();
                                      } catch (e: any) {
                                        setError(e?.message ?? 'Could not set that brand.');
                                      } finally {
                                        setBrandBusyTeamId(null);
                                      }
                                    }}
                                    style={{
                                      paddingHorizontal: 10,
                                      paddingVertical: 5,
                                      borderRadius: 999,
                                      backgroundColor: active ? c.brand : c.bgSubtle,
                                      borderWidth: 1,
                                      borderColor: active ? c.brand : c.border,
                                      opacity: brandBusyTeamId === t.id ? 0.5 : 1,
                                    }}
                                  >
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: active ? '#fff' : c.text }}>
                                      {brand.name}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })
                    : null}

                  {addableTeams.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {addableTeams.map((t) => (
                        <Pressable
                          key={t.id}
                          onPress={() => handleAddTeam(t.id)}
                          disabled={teamBusy === t.id}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            borderWidth: 1,
                            borderColor: c.border,
                            borderRadius: 999,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            opacity: teamBusy === t.id ? 0.5 : 1,
                          }}
                        >
                          <Ionicons name="add" size={13} color={c.text} />
                          <Text style={{ fontSize: 12, color: c.text }}>{t.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
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
                        {live.name} will be signed out and will not be able to sign in again until you reactivate
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
                      onPress={() => (live.active ? setConfirmingDeactivate(true) : applyActive(true))}
                      disabled={loading}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        borderWidth: 1,
                        borderColor: live.active ? c.roseSoft : c.border,
                        backgroundColor: live.active ? c.roseSoft : 'transparent',
                        borderRadius: 14,
                        paddingVertical: 14,
                        opacity: loading ? 0.5 : 1,
                      }}
                    >
                      <Ionicons
                        name={live.active ? 'ban-outline' : 'checkmark-circle-outline'}
                        size={18}
                        color={live.active ? c.rose : c.text}
                      />
                      <Text style={{ color: live.active ? c.rose : c.text, fontWeight: '700', fontSize: 15 }}>
                        {live.active ? 'Deactivate account' : 'Reactivate account'}
                      </Text>
                    </Pressable>
                  )}

                  {isOwner && !live.active && !confirmingDeactivate ? (
                    <Pressable
                      onPress={() => setConfirmingDelete(true)}
                      disabled={loading}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        marginTop: 10,
                        borderRadius: 14,
                        paddingVertical: 14,
                        backgroundColor: c.rose,
                        opacity: loading ? 0.5 : 1,
                      }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Delete staff member</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}

                </>
              ) : (
                // Branch managers only view their staff — only the admin changes accounts.
                <Text style={{ fontSize: 13, color: c.textMuted }}>
                  {memberTeams.map((tm) => tm.name).join(', ') || '—'}
                </Text>
              )}
              <View style={{ height: 10 }} />
              <SecondaryButton title="Close" onPress={onClose} />
            </ScrollView>

            {confirmingDelete ? (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 24,
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  justifyContent: 'center',
                  padding: 24,
                }}
              >
                <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: c.border }}>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: c.roseSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      alignSelf: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <Ionicons name="trash-outline" size={22} color={c.rose} />
                  </View>
                  <Text style={{ fontSize: 17, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 8 }}>
                    Delete {live.name}?
                  </Text>
                  <Text style={{ fontSize: 13, color: c.textMuted, textAlign: 'center', marginBottom: 18, lineHeight: 19 }}>
                    They'll be removed from Staff and can never sign in again. Their username becomes free to reuse. Audits
                    already done on them stay in History and reports. This can't be undone.
                  </Text>
                  <Pressable
                    onPress={applyDelete}
                    disabled={loading}
                    style={{ alignItems: 'center', backgroundColor: c.rose, borderRadius: 12, paddingVertical: 13, opacity: loading ? 0.5 : 1 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{loading ? 'Deleting…' : 'Yes, delete'}</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmingDelete(false)} disabled={loading} style={{ alignItems: 'center', paddingVertical: 12 }}>
                    <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
