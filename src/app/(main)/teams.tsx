import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BranchLocationPicker, type PinnedLocation } from '@/components/BranchLocationPicker';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOrgData } from '@/hooks/useOrgData';
import { Card, FieldInput, PrimaryButton, SecondaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import { ON_ACCENT } from '@/theme';
import { initials } from '@/lib/taskUtils';

export default function TeamsScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { teams, members, tasks, createTeam, brands, branchBrandIds, createBrand, setBranchBrands } = useOrgData();
  const [pinningTeam, setPinningTeam] = useState<{ id: string; loc: PinnedLocation | null } | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managingBranchId, setManagingBranchId] = useState<string | null>(null);
  const [stagedBrandIds, setStagedBrandIds] = useState<string[]>([]);
  const [newBrandName, setNewBrandName] = useState('');
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newTeamName.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      await createTeam(newTeamName.trim());
      setNewTeamName('');
      setCreating(false);
    } catch (e: any) {
      setError(e?.message ?? t('teams.genericError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('teams.title')}</Text>
          <Pressable
            onPress={() => setCreating(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }}
          >
            <Ionicons name="add" size={16} color={ON_ACCENT} />
            <Text style={{ color: ON_ACCENT, fontSize: 13, fontWeight: '700' }}>{t('teams.addTeam')}</Text>
          </Pressable>
        </View>

        {teams.map((team) => {
          const teamMembers = members.filter((m) => m.teamIds.includes(team.id));
          const admin = teamMembers.find((m) => m.role === 'team_admin');
          const teamTasks = tasks.filter((t) => t.teamId === team.id);
          const pending = teamTasks.filter((t) => !t.completed).length;
          return (
            <Pressable
              key={team.id}
              onPress={() => {
                setManagingBranchId(team.id);
                setStagedBrandIds(branchBrandIds[team.id] ?? []);
                setBrandError(null);
              }}
            >
              <Card style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{team.name}</Text>
                  <Text style={{ fontSize: 12, color: c.textMuted }}>{t('teams.pendingCount', { count: pending })}</Text>
                </View>
                <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                  {admin ? t('teams.adminLabel', { name: admin.name }) : t('teams.noAdminAssigned')}
                </Text>
                <Pressable
                  onPress={() => {
                    setPinError(null);
                    setPinningTeam({
                      id: team.id,
                      loc: team.lat != null && team.lng != null ? { lat: team.lat, lng: team.lng, radiusM: team.radiusM ?? 15 } : null,
                    });
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}
                >
                  <Ionicons name={team.lat != null ? 'location' : 'location-outline'} size={14} color={team.lat != null ? c.emerald : c.amber} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: team.lat != null ? c.emerald : c.amber }}>
                    {team.lat != null ? t('branchLoc.pinned', { m: team.radiusM ?? 15 }) : t('branchLoc.notPinned')}
                  </Text>
                </Pressable>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {teamMembers.map((m) => (
                    <View
                      key={m.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5,
                        backgroundColor: c.bgSubtle,
                        borderRadius: 999,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                      }}
                    >
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}>{initials(m.name)}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: c.text }}>{m.name}</Text>
                      {m.role === 'team_admin' ? <Text style={{ fontSize: 9, color: c.brand, fontWeight: '700' }}>{t('teams.memberBadgeAdmin')}</Text> : null}
                    </View>
                  ))}
                  {teamMembers.length === 0 ? <Text style={{ fontSize: 12, color: c.textFaint }}>{t('teams.noMembersYet')}</Text> : null}
                </View>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={creating} animationType="slide" transparent onRequestClose={() => setCreating(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 16 }}>{t('teams.newTeamTitle')}</Text>
            {error ? <ErrorBanner message={error} /> : null}
            <FieldInput label={t('teams.teamNameLabel')} placeholder={t('teams.teamNamePlaceholder')} value={newTeamName} onChangeText={setNewTeamName} />

            <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 14 }}>
              {t('teams.addLeaderHint')}
            </Text>

            <PrimaryButton title={t('teams.createTeam')} onPress={handleCreate} loading={loading} disabled={!newTeamName.trim()} />
            <View style={{ height: 10 }} />
            <SecondaryButton title={t('common.cancel')} onPress={() => setCreating(false)} />
          </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={!!managingBranchId} animationType="slide" transparent onRequestClose={() => setManagingBranchId(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 4 }}>
                {t('teams.manageBrandsTitle', { name: teams.find((team) => team.id === managingBranchId)?.name })}
              </Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 16 }}>{t('teams.manageBrandsHint')}</Text>
              {brandError ? <ErrorBanner message={brandError} /> : null}

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {brands.map((b) => {
                  const active = stagedBrandIds.includes(b.id);
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() =>
                        setStagedBrandIds((prev) => (active ? prev.filter((id) => id !== b.id) : [...prev, b.id]))
                      }
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 999,
                        backgroundColor: active ? c.brand : c.bgSubtle,
                        borderWidth: 1,
                        borderColor: active ? c.brand : c.border,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{b.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <FieldInput
                    placeholder={t('teams.newBrandPlaceholder')}
                    value={newBrandName}
                    onChangeText={setNewBrandName}
                  />
                </View>
                <Pressable
                  onPress={async () => {
                    if (!newBrandName.trim()) return;
                    setBrandLoading(true);
                    setBrandError(null);
                    try {
                      const id = await createBrand(newBrandName.trim());
                      setStagedBrandIds((prev) => [...prev, id]);
                      setNewBrandName('');
                    } catch (e: any) {
                      setBrandError(e?.message ?? t('teams.genericError'));
                    } finally {
                      setBrandLoading(false);
                    }
                  }}
                  style={{ borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: c.card }}
                >
                  <Ionicons name="add" size={18} color={c.text} />
                </Pressable>
              </View>

              <PrimaryButton
                title={t('common.save')}
                loading={brandLoading}
                onPress={async () => {
                  if (!managingBranchId) return;
                  setBrandLoading(true);
                  setBrandError(null);
                  try {
                    await setBranchBrands(managingBranchId, stagedBrandIds);
                    setManagingBranchId(null);
                  } catch (e: any) {
                    setBrandError(e?.message ?? t('teams.genericError'));
                  } finally {
                    setBrandLoading(false);
                  }
                }}
              />
              <View style={{ height: 10 }} />
              <SecondaryButton title={t('common.cancel')} onPress={() => setManagingBranchId(null)} />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      {pinningTeam ? (
        <BranchLocationPicker
          visible
          initial={pinningTeam.loc}
          onClose={() => setPinningTeam(null)}
          onSave={async (loc) => {
            const { error } = await supabase.rpc('set_team_location', {
              p_team_id: pinningTeam.id, p_lat: loc.lat, p_lng: loc.lng, p_radius_m: loc.radiusM,
            });
            if (error) setPinError(error.message);
            setPinningTeam(null);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}
