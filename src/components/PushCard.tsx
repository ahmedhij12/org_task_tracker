import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useWebPush } from '@/hooks/useWebPush';
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';

/** Settings card to turn on browser notifications. Hidden where push isn't
 * possible; on iPhone it explains the Home-Screen step first. */
export function PushCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { state, busy, enable } = useWebPush();

  if (state === 'unsupported') return null;

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>{t('push.pushTitle')}</Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 12 }}>{t('push.pushOnHint')}</Text>

      {state === 'granted' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="checkmark-circle" size={20} color={c.emerald} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.emerald }}>{t('push.pushOn')}</Text>
        </View>
      ) : state === 'needs-install' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Ionicons name="phone-portrait-outline" size={18} color={c.textMuted} />
          <Text style={{ flex: 1, fontSize: 13, color: c.text }}>{t('push.pushNeedsInstall')}</Text>
        </View>
      ) : state === 'denied' ? (
        <Text style={{ fontSize: 13, color: c.rose }}>{t('push.pushDenied')}</Text>
      ) : busy ? (
        <ActivityIndicator color={c.brand} />
      ) : (
        <PrimaryButton title={t('push.pushEnable')} onPress={enable} />
      )}
    </Card>
  );
}
