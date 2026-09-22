import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

// Public VAPID key — safe to ship in the app (only the private key must stay
// secret, and it lives in the bd-push worker).
const VAPID_PUBLIC = 'BEqHHjQUwRHuM8c2AbyGqRqNWEG2Cq5SdvP1F5Z28hABEHJemh-rJg5ckQyuYOSbjMdMYhHDkJKPhGJ6H3RFhnY';

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);
  return arr;
}

function isStandalone(): boolean {
  // iOS Safari only allows push once the site is added to the Home Screen.
  return (
    (typeof navigator !== 'undefined' && (navigator as any).standalone === true) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true)
  );
}

/** Web-only push. Returns a state and an enable() that asks permission and
 * registers the browser's subscription. A no-op on native (that uses Expo push). */
export function useWebPush() {
  const [state, setState] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState(false);

  const compute = useCallback((): PushState => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return 'unsupported';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    // On iOS the APIs exist but only work inside the installed Home-Screen app.
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (iOS && !isStandalone()) return 'needs-install';
    return Notification.permission as PushState;
  }, []);

  useEffect(() => {
    setState(compute());
    if (Platform.OS === 'web' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [compute]);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm as PushState); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      });
      const json = sub.toJSON();
      await supabase.rpc('save_web_push_subscription', {
        p_endpoint: sub.endpoint,
        p_p256dh: json.keys?.p256dh,
        p_auth: json.keys?.auth,
      });
      setState('granted');
    } catch {
      setState(compute());
    } finally {
      setBusy(false);
    }
  }, [compute]);

  return { state, busy, enable };
}
