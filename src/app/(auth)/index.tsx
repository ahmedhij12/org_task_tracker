import { useEffect } from 'react';
import { View, Text, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { PrimaryButton, useThemeColors } from '@/components/ui';
import { wasSignedOutElsewhere } from '@/hooks/useSingleDevice';

export default function LandingScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();

  // A phone signed out because the account was opened on another one lands
  // here; take it straight to sign-in, which says why.
  useEffect(() => {
    wasSignedOutElsewhere().then((yes) => {
      if (yes) router.push('/(auth)/signin');
    });
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 48 }}>
        <View style={{ alignItems: 'center', marginBottom: 40 }}>
          <View
            style={{
              width: 76,
              height: 76,
              borderRadius: 22,
              overflow: 'hidden',
              marginBottom: 18,
              // The icon is white: a hairline keeps it from vanishing on the light theme.
              borderWidth: 1,
              borderColor: c.border,
            }}
          >
            <Image
              source={require('../../../assets/icon.png')}
              style={{ width: 76, height: 76 }}
              resizeMode="cover"
            />
          </View>
          <Text style={{ fontSize: 26, fontWeight: '800', color: c.text }}>BD Audit</Text>
          <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', marginTop: 8, maxWidth: 260, lineHeight: 20 }}>
            {t('auth.landing.tagline')}
          </Text>
        </View>

        {/* Accounts are created by the admin, so sign-in is the only way in.
            Creating a new organization stays reachable at /create by URL only. */}
        <PrimaryButton title={t('common.signIn')} onPress={() => router.push('/(auth)/signin')} />
        <Text style={{ fontSize: 12, color: c.textFaint, textAlign: 'center', marginTop: 14, lineHeight: 18 }}>
          {t('auth.landing.signInHint')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
