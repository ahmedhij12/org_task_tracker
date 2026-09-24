import { ScrollView, Text, Pressable, I18nManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useThemeColors } from '@/components/ui';
import { PointValueCard } from '@/components/control/PointValueCard';
import { FryersCard } from '@/components/control/FryersCard';

/**
 * The control panel: every setting that decides how the app behaves for the
 * whole company, in one place, so a change never needs a developer or a new
 * build. Admins only — in the database that is role 'owner' today (the super
 * admin is an owner with is_super_admin). Settings keeps only personal things.
 * Each setting is its own card in src/components/control/; later work adds
 * cards here.
 */
export default function ControlPanelScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();

  if (!profile) return null;
  // Direct URL on the web build: a non-admin lands back in Settings. The
  // database refuses their writes anyway; this is about not showing the screen.
  if (profile.role !== 'owner') return <Redirect href="/(main)/settings" />;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(main)/settings'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={goBack}
          hitSlop={8}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: 12 }}
        >
          {/* Follows the layout's real direction, which only flips after a restart. */}
          <Ionicons name={I18nManager.isRTL ? 'chevron-forward' : 'chevron-back'} size={20} color={c.textMuted} />
          <Text style={{ color: c.textMuted, fontWeight: '600', fontSize: 14 }}>{t('control.back')}</Text>
        </Pressable>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('control.title')}</Text>
        <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 20 }}>{t('control.subtitle')}</Text>

        <PointValueCard />
        <FryersCard />
      </ScrollView>
    </SafeAreaView>
  );
}
