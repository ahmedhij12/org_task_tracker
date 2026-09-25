import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

// Module scope: this must run exactly once, not per hook mount, and before
// any notification could possibly arrive. By default expo-notifications
// shows nothing while the app is foregrounded — reminders can arrive up to
// 5 minutes before the due time, when the user is quite likely to still be
// in the app, so without this nothing would ever be seen.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowAlert is deprecated in this SDK version in favor of the two
    // below (see AGENTS.md — Expo has changed, check the versioned docs).
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Requests notification permission and registers this device's Expo push
 * token in `push_tokens`, so any server-side notifier (task reminders, a
 * completion alert to a reviewer) has somewhere to send to. Silently does
 * nothing on a simulator (no push capability) or if the user denies
 * permission — reminders just won't fire, nothing else breaks.
 */
export function usePushRegistration() {
  const { session } = useAuth();

  useEffect(() => {
    // The web app registers through useWebPush (from a tap). Here, on web, this
    // asked the browser for permission on every open with no tap — iPhone
    // refuses that, and Chrome on Android penalises it by quieting the site's
    // later prompts. Native builds only.
    if (Platform.OS === 'web') return;
    if (!session || !Device.isDevice) return;

    (async () => {
      try {
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

        const { error } = await supabase.from('push_tokens').upsert(
          {
            owner_id: session.user.id,
            expo_push_token: tokenData,
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
          },
          { onConflict: 'owner_id,expo_push_token' }
        );
        if (error) console.warn('Failed to store push token:', error);
      } catch (e) {
        // This is a background registration, not a user-initiated action —
        // getExpoPushTokenAsync throws (not returns an error) on a bad
        // projectId, missing push credentials, or a network failure, so
        // fail silently-but-logged rather than an unhandled rejection.
        console.warn('Push registration failed:', e);
      }
    })();
  }, [session]);
}
