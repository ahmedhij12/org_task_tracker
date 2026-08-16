import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { OrgDataProvider } from '@/hooks/useOrgData';
import { useThemeColors } from '@/components/ui';

export default function MainLayout() {
  const { profile } = useAuth();
  const c = useThemeColors();
  const isOwner = profile?.role === 'owner';
  const isEmployee = profile?.role === 'employee';

  return (
    <OrgDataProvider>
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
            title: isEmployee ? 'My Tasks' : 'Dashboard',
            tabBarIcon: ({ color, size }) => <Ionicons name={isEmployee ? 'list' : 'grid'} size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="teams"
          options={{
            title: 'Teams',
            href: isOwner ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="people"
          options={{
            title: 'People',
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
            title: 'Settings',
            tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          }}
        />
      </Tabs>
    </OrgDataProvider>
  );
}
