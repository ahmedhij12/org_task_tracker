import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

/**
 * Requests notification permission and registers this device's Expo push
 * token, so the personal-reminders Edge Function (see
 * supabase/functions/send-personal-reminders) has somewhere to send to.
 * Silently does nothing on a simulator (no push capability) or if the user
 * denies permission — reminders just won't fire, nothing else breaks.
 */
export function usePushRegistration() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session || !Device.isDevice) return;

    (async () => {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;

      const { data: tokenData } = await Notifications.getExpoPushTokenAsync({
        projectId: '530bebab-883e-4990-9221-1774115305ec',
      });

      await supabase.from('push_tokens').upsert(
        {
          owner_id: session.user.id,
          expo_push_token: tokenData,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        },
        { onConflict: 'owner_id,expo_push_token' }
      );
    })();
  }, [session]);
}
