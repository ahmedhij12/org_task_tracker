import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

const SIGNED_OUT_ELSEWHERE = 'bd.signedOutElsewhere';

/**
 * One phone per account (his rule, 2026-09-25). Signing in signs every other
 * device out (useAuth → signOut({ scope: 'others' })); this is the other half:
 * each phone keeps asking whether its own sign-in still exists — when it comes
 * back to the front and every minute while open — and leaves the moment it is
 * gone, instead of an hour later when its token would expire. A failed check
 * (offline, server busy) never signs anyone out.
 */
export function useSingleDevice() {
  const { profile } = useAuth();
  useEffect(() => {
    if (!profile) return;
    let stopped = false;
    const check = async () => {
      const { data, error } = await supabase.rpc('my_session_alive');
      if (stopped || error || data !== false) return;
      stopped = true;
      try {
        await AsyncStorage.setItem(SIGNED_OUT_ELSEWHERE, '1');
      } catch {}
      await supabase.auth.signOut({ scope: 'local' });
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    const timer = setInterval(check, 60000);
    return () => {
      stopped = true;
      sub.remove();
      clearInterval(timer);
    };
  }, [profile?.id]);
}

/** Whether the last sign-out was caused by another phone, without clearing it. */
export async function wasSignedOutElsewhere(): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(SIGNED_OUT_ELSEWHERE));
  } catch {
    return false;
  }
}

/** True once after a sign-out caused by another phone, so the sign-in screen can say why. */
export async function takeSignedOutElsewhere(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(SIGNED_OUT_ELSEWHERE);
    if (v) await AsyncStorage.removeItem(SIGNED_OUT_ELSEWHERE);
    return !!v;
  } catch {
    return false;
  }
}
