import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { OrgDataProvider } from '@/hooks/useOrgData';
import { ChecklistDataProvider } from '@/hooks/useChecklists';
import { OilTestsProvider } from '@/hooks/useOilTests';
import { ChickenProvider } from '@/hooks/useChicken';
import { PermissionsOnboarding } from '@/components/PermissionsOnboarding';
import { ConfirmBranchLocation } from '@/components/ConfirmBranchLocation';
import { useUnverifiedChecklistCount } from '@/hooks/useSupervisorChecklists';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/components/ui';

export default function MainLayout() {
  usePushRegistration();

  return (
    <OrgDataProvider>
      <ChecklistDataProvider>
        <OilTestsProvider>
          <ChickenProvider>
            <MainTabs />
            <PermissionsOnboarding />
            <ConfirmBranchLocation />
          </ChickenProvider>
        </OilTestsProvider>
      </ChecklistDataProvider>
    </OrgDataProvider>
  );
}

// Inside the data providers so the Checklists tab can show a live badge.
function MainTabs() {
  const { profile } = useAuth();
  const c = useThemeColors();
  const { t, i18n } = useTranslation();
  const isOwner = profile?.role === 'owner';
  const isEmployee = profile?.role === 'employee';
  const unverified = useUnverifiedChecklistCount();
  const isArabic = i18n.language?.startsWith('ar');
  const insets = useSafeAreaInsets();

  return (
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.accent,
          tabBarInactiveTintColor: c.textFaint,
          // Seven tabs, and the stock bar is too short for the labels of either
          // language — English descenders were clipped too, it was just less
          // obvious than Arabic. The fix is a TALLER bar for both; nudging a
          // label down inside a fixed box only pushes it out of sight. The
          // smaller type also buys back horizontal room on seven tabs.
          tabBarStyle: {
            backgroundColor: c.bg,
            borderTopColor: c.border,
            height: 64 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom + 6,
          },
          tabBarLabelStyle: { fontSize: 10 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('mainTabs.dashboard'),
            tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="teams"
          options={{
            title: t('mainTabs.teams'),
            href: isOwner ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="report"
          options={{
            title: t('mainTabs.report'),
            href: isOwner ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="checklists"
          options={{
            title: t('mainTabs.checklists'),
            href: isEmployee ? null : undefined,
            tabBarBadge: !isEmployee && unverified > 0 ? unverified : undefined,
            tabBarIcon: ({ color, size }) => <Ionicons name="clipboard" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: t('mainTabs.history'),
            tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="people"
          options={{
            title: t('mainTabs.people'),
            // Employees have no one to manage, so the tab is hidden for them.
            href: isEmployee ? null : undefined,
            tabBarIcon: ({ color, size }) => <Ionicons name="person-add" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="create-task"
          options={{
            href: null, // pushed programmatically, not a tab destination
          }}
        />
        <Tabs.Screen
          name="control-panel"
          options={{
            href: null, // reached from Settings, not a tab
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: t('mainTabs.settings'),
            tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          }}
        />
      </Tabs>
  );
}
