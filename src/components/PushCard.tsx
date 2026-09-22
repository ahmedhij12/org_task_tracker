import { useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useWebPush } from '@/hooks/useWebPush';
import { Card, PrimaryButton, useThemeColors } from '@/components/ui';

/** Settings card to turn on browser notifications. Hidden where push isn't
 * possible; on iPhone it explains the Home-Screen step first. Shows the real
 * reason when turning them on fails, and can send a test to prove delivery. */
export function PushCard() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { state, busy, enable, detail } = useWebPush();
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  if (state === 'unsupported') return null;

  const sendTest = async () => {
    setTesting(true); setTestMsg(null);
    const { data, error } = await supabase.rpc('send_test_push');
    setTestMsg(error ? error.message : data && Number(data) > 0 ? t('push.testSent') : t('push.testNoSub'));
    setTesting(false);
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>{t('push.pushTitle')}</Text>
      <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 12 }}>{t('push.pushOnHint')}</Text>

      {state === 'granted' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Ionicons name="checkmark-circle" size={20} color={c.emerald} />
            <Text style={{ fontSize: 14, fontWeight: '700', color: c.emerald }}>{t('push.pushOn')}</Text>
          </View>
          {testing ? <ActivityIndicator color={c.brand} /> : (
            <Pressable onPress={sendTest} style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: c.brand }}>{t('push.sendTest')}</Text>
            </Pressable>
          )}
          {testMsg ? <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 8 }}>{testMsg}</Text> : null}
        </>
      ) : state === 'needs-install' ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Ionicons name="phone-portrait-outline" size={18} color={c.amber} />
          <Text style={{ flex: 1, fontSize: 13, color: c.text }}>{t('push.pushNeedsInstall')}</Text>
        </View>
      ) : state === 'denied' ? (
        <Text style={{ fontSize: 13, color: c.rose }}>{t('push.pushDenied')}</Text>
      ) : busy ? (
        <ActivityIndicator color={c.brand} />
      ) : (
        <PrimaryButton title={t('push.pushEnable')} onPress={enable} />
      )}

      {detail ? (
        <Text style={{ fontSize: 11, color: c.rose, marginTop: 10 }}>{detail}</Text>
      ) : null}
    </Card>
  );
}
