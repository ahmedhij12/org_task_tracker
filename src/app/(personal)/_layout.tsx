import { Stack } from 'expo-router';
import { usePushRegistration } from '@/hooks/usePushRegistration';

export default function PersonalLayout() {
  // Registers for push notifications on entering personal mode at all, not
  // only when the user happens to open Settings — see Fix 3 in the
  // 2026-08-24 personal-mode final fix wave. The hook is idempotent, so
  // Settings keeping its own call too is harmless.
  usePushRegistration();
  return <Stack screenOptions={{ headerShown: false }} />;
}
