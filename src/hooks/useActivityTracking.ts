import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { isWatchedAdmin, logActivity } from '@/lib/activityLog';
import { refreshQuietLocation, startQuietLocation, stopQuietLocation, whenLocationTried } from '@/lib/quietLocation';

/**
 * Records, for the super admin, when a watched admin opens or comes back to
 * the app and which screens they open — each line with where the phone was,
 * when location is already allowed (quietLocation). Does nothing for anyone
 * else (see logActivity). Mounted once, in the signed-in layout.
 */
export function useActivityTracking() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const opened = useRef(false);
  const watched = isWatchedAdmin(profile);

  useEffect(() => {
    if (!watched) {
      stopQuietLocation();
      return;
    }
    startQuietLocation();
    // Fresh every few minutes while open, so a change made later in the
    // session carries where it was made.
    const timer = setInterval(() => refreshQuietLocation(), 3 * 60000);
    return () => clearInterval(timer);
  }, [watched]);

  useEffect(() => {
    if (!profile || opened.current) return;
    opened.current = true;
    whenLocationTried().then(() => logActivity(profile, 'sign_in', 'open'));
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (!isWatchedAdmin(profile)) return logActivity(profile, 'sign_in', 'resume');
      refreshQuietLocation().then(() => logActivity(profile, 'sign_in', 'resume'));
    });
    return () => sub.remove();
  }, [profile]);

  useEffect(() => {
    if (profile) whenLocationTried().then(() => logActivity(profile, 'view', pathname));
  }, [pathname, profile?.id]);
}
