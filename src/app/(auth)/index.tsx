import { View, Text, Pressable, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useThemeColors } from '@/components/ui';

export default function LandingScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();

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
            }}
          >
            <Image
              source={require('../../../assets/icon.png')}
              style={{ width: 76, height: 76 }}
              resizeMode="cover"
            />
          </View>
          <Text style={{ fontSize: 26, fontWeight: '800', color: c.text }}>Rungs</Text>
          <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', marginTop: 8, maxWidth: 260, lineHeight: 20 }}>
            {t('auth.landing.tagline')}
          </Text>
        </View>

        <ChoiceRow
          icon="business"
          title={t('auth.landing.createOrgTitle')}
          subtitle={t('auth.landing.createOrgSubtitle')}
          onPress={() => router.push('/(auth)/create')}
        />

        <Pressable onPress={() => router.push('/(auth)/signin')} style={{ marginTop: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 14, color: c.textMuted }}>
            {t('auth.landing.alreadyHaveAccount')} <Text style={{ color: c.indigo, fontWeight: '700' }}>{t('common.signIn')}</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ChoiceRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 18,
        padding: 16,
        backgroundColor: pressed ? c.bgSubtle : c.card,
      })}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          backgroundColor: c.indigoSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={22} color={c.indigo} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{title}</Text>
        <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 2 }}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
    </Pressable>
  );
}
