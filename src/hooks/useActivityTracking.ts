import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { logActivity } from '@/lib/activityLog';

/**
 * Records, for the super admin, when a watched admin opens or comes back to
 * the app and which screens they open. Does nothing for anyone else (see
 * logActivity). Mounted once, in the signed-in layout.
 */
export function useActivityTracking() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const opened = useRef(false);

  useEffect(() => {
    if (!profile || opened.current) return;
    opened.current = true;
    logActivity(profile, 'sign_in', 'open');
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') logActivity(profile, 'sign_in', 'resume');
    });
    return () => sub.remove();
  }, [profile]);

  useEffect(() => {
    if (profile) logActivity(profile, 'view', pathname);
  }, [pathname, profile?.id]);
}
