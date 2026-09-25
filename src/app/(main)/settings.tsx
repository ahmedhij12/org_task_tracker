import { View, Text, ScrollView, Pressable, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PushCard } from '@/components/PushCard';
import { RecoveryEmailCard } from '@/components/RecoveryEmailCard';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { MenuButton } from '@/components/SideMenu';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useThemePref } from '@/hooks/useThemePref';
import { useLanguagePref, type LanguagePref } from '@/hooks/useLanguagePref';
import { Card, FieldInput, PrimaryButton, ErrorBanner, useThemeColors } from '@/components/ui';
import type { ThemePref } from '@/types';

export default function SettingsScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile, organization, teams, signOut, updateMyProfile } = useAuth();
  const { themePref, setThemePref } = useThemePref();
  const { languagePref, setLanguagePref, needsRestartForDirection } = useLanguagePref();
  const [copied, setCopied] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameText, setNameText] = useState(profile?.name ?? '');
  const [codeText, setCodeText] = useState(profile?.employeeCode ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  // In-app rather than Alert.alert: react-native-web does not implement Alert
  // with buttons, so the callback never fires and sign-out silently did nothing.
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const roleLabel =
    profile?.role === 'owner'
      ? t('settings.roleAdmin')
      : profile?.role === 'hygiene_auditor'
        ? t('settings.roleHygieneAuditor')
        : profile?.role === 'team_admin'
          ? t('settings.roleManager')
          : t('settings.roleSupervisor');

  const handleCopy = async () => {
    if (!organization) return;
    await Clipboard.setStringAsync(organization.orgCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handlePickPhoto = async () => {
    if (!profile || !organization || uploadingPhoto) return;
    setProfileError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });
      if (result.canceled || !result.assets[0]?.base64) return;
      setUploadingPhoto(true);
      const path = `${organization.id}/avatar-${profile.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('task-proofs')
        .upload(path, decode(result.assets[0].base64), { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const url = supabase.storage.from('task-proofs').getPublicUrl(path).data.publicUrl;
      await updateMyProfile(profile.name, profile.employeeCode ?? '', url);
    } catch (e: any) {
      setProfileError(e?.message ?? t('settings.photoFailed'));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!profile || savingProfile) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      await updateMyProfile(nameText, codeText, profile.avatarUrl);
      setEditingProfile(false);
    } catch (e: any) {
      setProfileError(e?.message ?? t('settings.profileFailed'));
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <MenuButton />
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('settings.title')}</Text>
        </View>

        <Card style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable onPress={handlePickPhoto} accessibilityLabel={t('settings.changePhoto')}>
              {profile?.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={{ width: 64, height: 64, borderRadius: 32 }} />
              ) : (
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 22 }}>{profile?.name?.[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: c.card,
                  borderWidth: 1,
                  borderColor: c.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {uploadingPhoto ? <ActivityIndicator size="small" color={c.brand} /> : <Ionicons name="camera" size={13} color={c.text} />}
              </View>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>{profile?.name}</Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                {profile?.username ? `@${profile.username} • ` : ''}
                {roleLabel}
                {teams.length > 0 ? ` • ${teams.map((t) => t.name).join(', ')}` : ''}
              </Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>
                {t('settings.companyId')}: {profile?.employeeCode ? <Text style={{ color: c.text, fontWeight: '700' }}>{profile.employeeCode}</Text> : '—'}
              </Text>
            </View>
            {!editingProfile ? (
              <Pressable
                onPress={() => {
                  setNameText(profile?.name ?? '');
                  setCodeText(profile?.employeeCode ?? '');
                  setProfileError(null);
                  setEditingProfile(true);
                }}
                hitSlop={8}
                accessibilityLabel={t('settings.editProfile')}
              >
                <Ionicons name="create-outline" size={20} color={c.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {profileError ? (
            <View style={{ marginTop: 12 }}>
              <ErrorBanner message={profileError} />
            </View>
          ) : null}

          {editingProfile ? (
            <View style={{ marginTop: 14 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 4 }}>{t('settings.name')}</Text>
              <FieldInput value={nameText} onChangeText={setNameText} placeholder={t('settings.namePlaceholder')} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 4 }}>{t('settings.companyIdLabel')}</Text>
              <FieldInput value={codeText} onChangeText={setCodeText} placeholder="e.g. 10452" autoCapitalize="characters" />
              <PrimaryButton title={t('settings.saveProfile')} onPress={handleSaveProfile} loading={savingProfile} disabled={!nameText.trim()} />
              <Pressable onPress={() => setEditingProfile(false)} style={{ alignItems: 'center', paddingVertical: 10 }}>
                <Text style={{ color: c.textMuted, fontWeight: '600' }}>{t('settings.cancel')}</Text>
              </Pressable>
            </View>
          ) : null}
        </Card>

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>{t('settings.organization')}</Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: c.text }}>{organization?.name}</Text>
          <Pressable onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Text style={{ fontSize: 13, color: c.textMuted }}>{t('settings.orgId')}: {organization?.orgCode}</Text>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={c.textMuted} />
          </Pressable>
        </Card>

        <PushCard />

        <RecoveryEmailCard />

        <Card style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>{t('settings.appearance')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                { key: 'light', label: t('settings.light'), icon: 'sunny' },
                { key: 'dark', label: t('settings.dark'), icon: 'moon' },
                { key: 'auto', label: t('settings.auto'), icon: 'phone-portrait' },
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
                    backgroundColor: active ? c.brand : c.bgSubtle,
                    borderWidth: 1,
                    borderColor: active ? c.brand : c.border,
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
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>{t('settings.language')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(
              [
                { key: 'en', label: 'English' },
                { key: 'ar', label: 'العربية' },
                { key: 'auto', label: t('settings.auto') },
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
                    backgroundColor: active ? c.brand : c.bgSubtle,
                    borderWidth: 1,
                    borderColor: active ? c.brand : c.border,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.text }}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {needsRestartForDirection ? (
            <Text style={{ fontSize: 11, color: c.textFaint, marginTop: 10 }}>
              {t('settings.rtlHint')}
            </Text>
          ) : null}
        </Card>

        {confirmingSignOut ? (
          <View style={{ borderWidth: 1, borderColor: c.roseSoft, backgroundColor: c.roseSoft, borderRadius: 14, padding: 14 }}>
            <Text style={{ color: c.rose, fontSize: 13, marginBottom: 12 }}>
              {t('settings.signOutConfirm', { org: organization?.name ?? "" })}
            </Text>
            <Pressable
              onPress={() => signOut()}
              style={{ alignItems: 'center', backgroundColor: c.rose, borderRadius: 12, paddingVertical: 12 }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{t('settings.yesSignOut')}</Text>
            </Pressable>
            <View style={{ height: 8 }} />
            <Pressable onPress={() => setConfirmingSignOut(false)} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: c.rose, fontWeight: '600', fontSize: 14 }}>{t('settings.stay')}</Text>
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
            <Text style={{ color: c.rose, fontWeight: '700', fontSize: 15 }}>{t('settings.signOut')}</Text>
          </Pressable>
        )}

        <Text style={{ fontSize: 11, color: c.textFaint, textAlign: 'center', marginTop: 24 }}>BD Audit • v2.1.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
