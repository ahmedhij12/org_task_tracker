import 'react-native-url-polyfill/auto';

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ThemePrefProvider, useThemePref } from '@/hooks/useThemePref';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemePrefProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemePrefProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { session, profile, loading } = useAuth();
  const { isDark } = useThemePref();

  if (loading) return null;

  const signedInWithOrg = !!session && !!profile;
  // An admin-created account (or one whose password an admin just reset)
  // cannot reach the app until it picks its own password.
  const needsPasswordChange = signedInWithOrg && !!profile?.mustChangePassword;

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedInWithOrg}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={needsPasswordChange}>
          <Stack.Screen name="change-password" />
        </Stack.Protected>
        <Stack.Protected guard={signedInWithOrg && !needsPasswordChange}>
          <Stack.Screen name="(main)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
