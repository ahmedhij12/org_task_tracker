import 'react-native-url-polyfill/auto';
import '@/lib/i18n';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ThemePrefProvider, useThemePref } from '@/hooks/useThemePref';
import { LanguagePrefProvider } from '@/hooks/useLanguagePref';
import { Colors } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LanguagePrefProvider>
          <ThemePrefProvider>
            <AuthProvider>
              <RootNavigator />
            </AuthProvider>
          </ThemePrefProvider>
        </LanguagePrefProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, profile, loading } = useAuth();
  const { isDark } = useThemePref();

  // Web: Safari paints its status bar and toolbar from the page behind the app,
  // so follow the in-app theme (which can differ from the system one).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const bg = Colors[isDark ? 'dark' : 'light'].bg;
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', bg);
      m.removeAttribute('media');
    });
  }, [isDark]);

  if (loading) return null;

  const signedIn = !!session && !!profile;
  // An admin-created account (or one whose password an admin just reset)
  // cannot reach the app until it picks its own password.
  const needsPasswordChange = signedIn && !!profile?.mustChangePassword;

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={needsPasswordChange}>
          <Stack.Screen name="change-password" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !needsPasswordChange}>
          <Stack.Screen name="(main)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
