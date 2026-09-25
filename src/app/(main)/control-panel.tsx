import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/roles';
import { useThemeColors } from '@/components/ui';
import { PointValueCard } from '@/components/control/PointValueCard';
import { FryersCard } from '@/components/control/FryersCard';
import { CheckInDistanceCard } from '@/components/control/CheckInDistanceCard';
import { MenuButton } from '@/components/SideMenu';
import { OilTimesCard } from '@/components/control/OilTimesCard';
import { MarinationRulesCard } from '@/components/control/MarinationRulesCard';
import { PenaltyAmountsCard } from '@/components/control/PenaltyAmountsCard';
import { PushTestCard } from '@/components/control/PushTestCard';
import { ChecklistDeadlinesCard } from '@/components/control/ChecklistDeadlinesCard';

/**
 * The control panel: every setting that decides how the app behaves for the
 * whole company, in one place, so a change never needs a developer or a new
 * build. For whoever has the "Control panel" switch — admins by default; an
 * admin turns it on for others in Staff → their sheet → Access (Fatima, the
 * hygiene auditor, first). The database's has_permission('control_panel') is
 * the real gate. Settings keeps only personal things. Each setting is its own
 * card in src/components/control/.
 */
export default function ControlPanelScreen() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const { profile } = useAuth();

  if (!profile) return null;
  // Whoever has the control panel switch (admins by default). Anyone else —
  // a direct URL on the web build — lands back in Settings; the database
  // refuses their writes anyway, this is about not showing the screen.
  if (!can(profile, 'control_panel')) return <Redirect href="/(main)/settings" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <MenuButton />
          <Text style={{ fontSize: 24, fontWeight: '800', color: c.text }}>{t('control.title')}</Text>
        </View>
        <Text style={{ fontSize: 13, color: c.textMuted, marginTop: 4, marginBottom: 20 }}>{t('control.subtitle')}</Text>

        <PointValueCard />
        <CheckInDistanceCard />
        <ChecklistDeadlinesCard />
        <OilTimesCard />
        <MarinationRulesCard />
        <PenaltyAmountsCard />
        <FryersCard />
        <PushTestCard />
      </ScrollView>
    </SafeAreaView>
  );
}
