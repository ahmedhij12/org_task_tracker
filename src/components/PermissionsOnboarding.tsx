import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useWebPush } from '@/hooks/useWebPush';
import { PrimaryButton, useThemeColors } from '@/components/ui';

const SEEN_KEY = 'rungs.permissionsAsked';

type Step = 'camera' | 'location' | 'notifications';

/**
 * Asked once, right after the first sign-in: camera, location while using the
 * app, and notifications. Getting them up front means a checklist or an oil
 * test never stalls halfway through asking for something.
 */
export function PermissionsOnboarding() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { state: pushState, enable: enablePush } = useWebPush();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<Step | null>(null);
  const [done, setDone] = useState<Record<Step, boolean>>({ camera: false, location: false, notifications: false });

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(SEEN_KEY)) return;
    } catch { /* private mode — just show it */ }
    setVisible(true);
  }, []);

  const finish = () => {
    try { localStorage?.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  };

  const askCamera = async () => {
    setBusy('camera');
    try { await ImagePicker.requestCameraPermissionsAsync(); } catch { /* denied is fine */ }
    setDone((d) => ({ ...d, camera: true }));
    setBusy(null);
  };

  const askLocation = async () => {
    setBusy('location');
    try { await Location.requestForegroundPermissionsAsync(); } catch { /* denied is fine */ }
    setDone((d) => ({ ...d, location: true }));
    setBusy(null);
  };

  const askNotifications = async () => {
    setBusy('notifications');
    try { await enablePush(); } catch { /* surfaced in Settings */ }
    setDone((d) => ({ ...d, notifications: true }));
    setBusy(null);
  };

  const row = (step: Step, icon: any, onPress: () => void, granted: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={c.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: c.text }}>{t(`perms.${step}Title`)}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{t(`perms.${step}Why`)}</Text>
      </View>
      {busy === step ? <ActivityIndicator color={c.brand} /> : granted ? (
        <Ionicons name="checkmark-circle" size={24} color={c.emerald} />
      ) : (
        <Pressable onPress={onPress} style={{ borderWidth: 1, borderColor: c.brand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: c.brand }}>{t('perms.allow')}</Text>
        </Pressable>
      )}
    </View>
  );

  // On iPhone, notifications only exist once the site runs from the Home Screen.
  const pushBlocked = pushState === 'needs-install' || pushState === 'unsupported';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={finish}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 }}>
          <Text style={{ fontSize: 19, fontWeight: '800', color: c.text, marginBottom: 4 }}>{t('perms.title')}</Text>
          <Text style={{ fontSize: 13, color: c.textMuted, marginBottom: 12 }}>{t('perms.subtitle')}</Text>

          {row('camera', 'camera', askCamera, done.camera)}
          {row('location', 'location', askLocation, done.location)}
          {pushBlocked ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: c.amberSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="notifications-off" size={20} color={c.amber} />
              </View>
              <Text style={{ flex: 1, fontSize: 12, color: c.text }}>{t('perms.pushNeedsInstall')}</Text>
            </View>
          ) : (
            row('notifications', 'notifications', askNotifications, done.notifications || pushState === 'granted')
          )}

          <View style={{ height: 16 }} />
          <PrimaryButton title={t('perms.done')} onPress={finish} />
        </View>
      </View>
    </Modal>
  );
}
