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

// What this phone last told the server, so several screens using this hook
// do not repeat the same report on every mount.
let lastReported = '';

/** Tells the server this phone's notification state (push_status), so the
 * control panel's push test shows who is reachable and why not — instead of
 * a guess like "Fatima turned it on". Best effort: never throws. */
function report(state: string, detail: string | null) {
  const key = `${state}|${detail ?? ''}`;
  if (key === lastReported) return;
  lastReported = key;
  supabase
    .rpc('report_push_state', {
      p_state: state,
      p_detail: detail,
      p_standalone: isStandalone(),
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    .then(() => {}, () => {});
}

/** Web-only push. Returns a state and an enable() that asks permission and
 * registers the browser's subscription. A no-op on native (that uses Expo push). */
export function useWebPush() {
  const [state, setState] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  const compute = useCallback((): PushState => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return 'unsupported';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    // On iOS the APIs exist but only work inside the installed Home-Screen app.
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (iOS && !isStandalone()) return 'needs-install';
    return Notification.permission as PushState;
  }, []);

  // Subscribe this browser and store it. Safe to call repeatedly.
  const subscribeAndSave = useCallback(async () => {
    await navigator.serviceWorker.register('/sw.js').catch(() => {});
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
    }));
    const json = sub.toJSON();
    const { error } = await supabase.rpc('save_web_push_subscription', {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.p256dh,
      p_auth: json.keys?.auth,
    });
    if (error) throw new Error(error.message);
    report('registered', null);
  }, []);

  useEffect(() => {
    const next = compute();
    setState(next);
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
    // Permission can already be granted while this browser was never actually
    // registered (it failed silently before). Repair that on load.
    if (next === 'granted') {
      subscribeAndSave().catch((e) => {
        const msg = String(e?.message ?? e).slice(0, 140);
        setDetail(msg);
        report('error', msg);
      });
    } else {
      report(next, null);
    }
  }, [compute, subscribeAndSave]);

  const enable = useCallback(async () => {
    setBusy(true);
    setDetail(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm as PushState); setDetail(`permission: ${perm}`); report(perm, null); return; }
      await subscribeAndSave();
      setState('granted');
    } catch (e: any) {
      // Surface it: a silent failure here is why nothing ever arrived.
      const msg = e?.message ? String(e.message).slice(0, 140) : 'subscribe failed';
      setDetail(msg);
      report('error', msg);
      setState(compute());
    } finally {
      setBusy(false);
    }
  }, [compute, subscribeAndSave]);

  return { state, busy, enable, detail, retry: subscribeAndSave };
}
