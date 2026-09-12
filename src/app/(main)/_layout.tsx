import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { OrgDataProvider } from '@/hooks/useOrgData';
import { ChecklistDataProvider } from '@/hooks/useChecklists';
import { useThemeColors } from '@/components/ui';

export default function MainLayout() {
  const { profile } = useAuth();
  const c = useThemeColors();
  const { t } = useTranslation();
  const isOwner = profile?.role === 'owner';
  const isEmployee = profile?.role === 'employee';
  usePushRegistration();

  return (
    <OrgDataProvider>
    <ChecklistDataProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.indigo,
          tabBarInactiveTintColor: c.textFaint,
          tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.border },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: isEmployee ? t('mainTabs.myTasks') : t('mainTabs.dashboard'),
            tabBarIcon: ({ color, size }) => <Ionicons name={isEmployee ? 'list' : 'grid'} size={size} color={color} />,
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
          name="settings"
          options={{
            title: t('mainTabs.settings'),
            tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          }}
        />
      </Tabs>
    </ChecklistDataProvider>
    </OrgDataProvider>
  );
}
